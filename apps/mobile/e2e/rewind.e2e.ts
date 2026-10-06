// Going back to one of your messages (rewind) in the PWA on the scripted fake SDK: from a long press on a message and
// from the chat's back button; restore conversation (prompt back in the box, transcript cut), restore code (files
// reported, transcript kept), and "Never mind" (nothing changes).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { button, composer, launchChrome, openProject, pairedPage, phone, send, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []

beforeAll(async () => (browser = await launchChrome()))
afterAll(() => browser.close())
beforeEach(async () => (backend = await startBackend()))
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

// A paired phone in a new session of the project folder, with two finished turns: "edit" (writes two files) and "hello".
async function twoTurns(): Promise<Page> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await openProject(page)
  await send(page, 'edit')
  await page.getByText('Edited: done').waitFor()
  await send(page, 'hello')
  await page.getByText('Echo: hello').waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' })
  return page
}

// A long press (touch held for half a second) on one of your messages.
async function longPress(page: Page, text: string): Promise<void> {
  const bubble = page.locator('.msg-user', { hasText: text })
  await bubble.dispatchEvent('touchstart')
  await page.getByRole('button', { name: 'Go back to before this message' }).waitFor()
  await bubble.dispatchEvent('touchend')
}

describe('PWA rewind (fake SDK)', () => {
  it('long press on the second message → Restore conversation → the transcript is cut and the prompt is back in the box', async () => {
    const page = await twoTurns()
    await longPress(page, 'hello')
    await page.getByRole('button', { name: 'Go back to before this message' }).click()
    await page.getByRole('button', { name: 'Restore conversation' }).first().waitFor()
    await button(page, 'Restore conversation').click()
    await page.getByText('Are you sure?').waitFor()
    await page.locator('.two-buttons .button.danger').click()
    await page.getByText('Conversation restored').waitFor()
    await composer(page).waitFor()
    await expect.poll(() => composer(page).inputValue()).toBe('hello')
    expect(await page.locator('.msg-user', { hasText: 'hello' }).count()).toBe(0)
    expect(await page.getByText('Echo: hello').count()).toBe(0)
    expect(await page.locator('.msg-user', { hasText: 'edit' }).count()).toBe(1)
    await page.getByText('Edited: done').waitFor()
  })

  it('the back button lists your messages (latest last); Restore code reports the files and keeps the transcript', async () => {
    const page = await twoTurns()
    await page.getByRole('button', { name: 'Go back to one of your messages' }).click()
    const rows = page.locator('.list .row .row-main')
    await rows.first().waitFor()
    expect(await rows.allInnerTexts()).toEqual(['edit', 'hello'])
    await rows.first().click()
    await page.locator('.rewind-files li').first().waitFor()
    expect(await page.locator('.rewind-files li').allInnerTexts()).toEqual(['src/app.ts', 'src/util.ts'])
    expect(await page.locator('.rewind-diff .added').innerText()).toBe('+6')
    await button(page, 'Restore code').click()
    await page.getByText('Are you sure?').waitFor()
    await page.locator('.two-buttons .button.danger').click()
    await page.getByText('Code restored (2 files)').waitFor()
    await composer(page).waitFor()
    expect(await page.locator('.msg-user').count()).toBe(2)
    await page.getByText('Echo: hello').waitFor()
    // The second message came after the edits: nothing to restore, only the conversation.
    await page.getByRole('button', { name: 'Go back to one of your messages' }).click()
    await page.locator('.list .row .row-main').last().click()
    await page.locator('.menu').waitFor()
    expect(await page.getByRole('button', { name: 'Restore code', exact: true }).count()).toBe(0)
  })

  it('Never mind closes the actions and changes nothing', async () => {
    const page = await twoTurns()
    await page.getByRole('button', { name: 'Go back to one of your messages' }).click()
    await page.locator('.list .row .row-main').first().click()
    await page.locator('.rewind-files li').first().waitFor()
    await button(page, 'Never mind').click()
    await page.locator('.menu').waitFor({ state: 'detached' })
    await page.locator('.list .row .row-main').first().waitFor()
    await button(page, 'Back').click()
    expect(await page.locator('.msg-user').count()).toBe(2)
    expect(await composer(page).inputValue()).toBe('')
    await page.getByText('Echo: hello').waitFor()
  })
})

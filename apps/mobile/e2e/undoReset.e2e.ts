// Shake to Undo on iPhone: when the app goes to the background the text fields are replaced by new elements (their
// typing undo history goes with the old ones) while the text, the height and the ability to type and send stay.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { button, composer, launchChrome, openProject, pairedPage, phone, startBackend, type Backend } from './harness.ts'

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

// Simulates the app going to the background and coming back.
async function backgroundAndBack(page: Page): Promise<void> {
  const setState = (state: string) => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
  await setState('hidden')
  await setState('visible')
}

describe('Undo reset (fake SDK)', () => {
  it('the composer gets a new element after the background, keeps draft and height, and still types and sends', async () => {
    const context = await phone(browser)
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await openProject(page)
    await composer(page).fill('one\ntwo\nthree\nfour')
    await composer(page).evaluate((element) => ((element as HTMLElement & { old?: boolean }).old = true))
    const height = await composer(page).evaluate((element) => element.getBoundingClientRect().height)
    await backgroundAndBack(page)
    expect(await composer(page).evaluate((element) => (element as HTMLElement & { old?: boolean }).old)).toBeUndefined()
    expect(await composer(page).inputValue()).toBe('one\ntwo\nthree\nfour')
    expect(await composer(page).evaluate((element) => element.getBoundingClientRect().height)).toBe(height)
    await composer(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' five')
    expect(await composer(page).inputValue()).toBe('one\ntwo\nthree\nfour five')
    await composer(page).fill('hello')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('Echo: hello').waitFor()
  })

  it('the note editor gets a new element after the background and keeps the text', async () => {
    const context = await phone(browser)
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await openProject(page)
    await button(page, 'More actions').click()
    await button(page, /^Folder notes/).click()
    await button(page, 'New note').click()
    const editor = page.locator('.note-editor')
    await editor.fill('a note to keep')
    await editor.evaluate((element) => ((element as HTMLElement & { old?: boolean }).old = true))
    await backgroundAndBack(page)
    expect(await editor.evaluate((element) => (element as HTMLElement & { old?: boolean }).old)).toBeUndefined()
    expect(await editor.inputValue()).toBe('a note to keep')
  })
})

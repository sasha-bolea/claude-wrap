// Phase 2, composer and commands on the scripted fake SDK. User stories:
// I pick a command from the `/` palette and see its output; I mention a file with `@`; I paste an image and
// Claude gets it; a long paste collapses and is sent whole; Up/Down and Ctrl+R bring back what I sent; a message sent
// while Claude works waits and is read in the same turn (sub-phase B); `!` runs a shell command in the folder.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { composer, launch, lastAnswer, openChat, send, type App } from './harness.ts'

// A 1×1 transparent PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let ctx: App

// Fires a paste on the composer, with a file or a text, as the system clipboard would.
async function paste(page: Page, content: { png: string } | { text: string }): Promise<void> {
  await composer(page).evaluate((field, pasted) => {
    const data = new DataTransfer()
    if ('png' in pasted) {
      const bytes = Uint8Array.from(atob(pasted.png), (char) => char.charCodeAt(0))
      data.items.add(new File([bytes], 'dot.png', { type: 'image/png' }))
    } else data.setData('text/plain', pasted.text)
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, content)
}

beforeEach(async () => {
  ctx = await launch()
  mkdirSync(join(ctx.projectDir, 'src'))
  writeFileSync(join(ctx.projectDir, 'src', 'main.ts'), '')
  await openChat(ctx.page, ctx.projectDir)
})
afterEach(() => ctx.close())

describe('composer (fake SDK)', () => {
  it('the / palette lists the CLI commands, filters them, and the picked command runs with visible output', async () => {
    const { page } = ctx
    await composer(page).fill('/co')
    const palette = page.getByRole('listbox', { name: 'Commands' })
    // Name prefix first; /clear matches by its description ("conversation").
    const expected = ['/compact', '/context', '/clear'].map((name) => expect.stringContaining(name))
    await expect.poll(() => palette.getByRole('option').allTextContents()).toEqual(expected)
    await composer(page).press('ArrowDown')
    await composer(page).press('Enter')
    expect(await composer(page).inputValue()).toBe('/context ')
    await composer(page).press('Enter')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Ran /context')
    expect(await page.locator('.msg-user').last().textContent()).toBe('/context')
  })

  it('@ suggests files of the folder and inserts the mention', async () => {
    const { page } = ctx
    await composer(page).fill('see @mai')
    await page.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: 'src/main.ts' }).waitFor()
    await composer(page).press('Tab')
    expect(await composer(page).inputValue()).toBe('see @src/main.ts ')
  })

  it('a pasted image is shown, sent to Claude and kept in the conversation', async () => {
    const { page } = ctx
    await paste(page, { png: PNG_BASE64 })
    await page.getByRole('img', { name: 'Image 1' }).waitFor()
    await send(page, 'what is it')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: what is it [1 images]')
    await page.locator('.msg-user img.thumb').waitFor()
    expect(await page.locator('.attachments').count()).toBe(0)
  })

  it('a long paste collapses into a placeholder and is sent whole', async () => {
    const { page } = ctx
    const log = Array.from({ length: 30 }, (_, n) => `l${n}`).join('\n')
    await composer(page).fill('log: ')
    await paste(page, { text: log })
    expect(await composer(page).inputValue()).toBe('log: [Pasted text #1 +29 lines]')
    await composer(page).press('Enter')
    await expect.poll(() => lastAnswer(page).textContent()).toContain('l29')
    expect(await page.locator('.msg-user').last().textContent()).toContain('l0\nl1')
  })

  it('Up/Down browse previous messages; Ctrl+R searches them', async () => {
    const { page } = ctx
    for (const text of ['first', 'second']) {
      await send(page, text)
      await expect.poll(() => lastAnswer(page).textContent()).toBe(`Echo: ${text}`)
    }
    const field = composer(page)
    await field.fill('draft')
    await field.press('Home')
    await field.press('ArrowUp')
    await expect.poll(() => field.inputValue()).toBe('second')
    await field.press('ArrowUp')
    await expect.poll(() => field.inputValue()).toBe('first')
    await field.press('ArrowDown')
    await expect.poll(() => field.inputValue()).toBe('second')
    await field.press('ArrowDown')
    await expect.poll(() => field.inputValue()).toBe('draft')
    await field.fill('fir')
    await field.press('Control+r')
    await page.getByRole('listbox', { name: 'Previous messages' }).getByRole('option', { name: 'first' }).waitFor()
    await field.press('Enter')
    expect(await field.inputValue()).toBe('first')
  })

  it('a message sent while Claude works waits, then Claude reads it in the same turn', async () => {
    const { page } = ctx
    await send(page, 'permission')
    const request = page.getByRole('region', { name: 'Permission request' })
    await request.waitFor()
    await send(page, 'also this')
    const waiting = page.locator('.msg-user.pending')
    await expect.poll(() => waiting.textContent()).toContain('waiting')
    await request.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect.poll(() => lastAnswer(page).textContent()).toContain('Echo: also this')
    expect(await waiting.count()).toBe(0)
    expect(await page.locator('.turn-end').count()).toBe(1)
  })

  it('! runs a shell command in the folder and shows its output', async () => {
    const { page } = ctx
    await send(page, '!echo hello-shell')
    await expect.poll(() => page.locator('.shell').textContent()).toContain('hello-shell')
    expect(await page.locator('.shell .cmd').textContent()).toBe('$ echo hello-shell')
    // No turn ran: the CLI's empty results for the transcript-only messages are not shown.
    await page.waitForTimeout(300)
    expect(await page.locator('.turn-end').count()).toBe(0)
    await send(page, 'after')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: after')
  })
})

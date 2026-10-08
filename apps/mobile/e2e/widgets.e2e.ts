// Chat widgets in the PWA on the scripted fake SDK (keyword `widget`, `widget <name>`). User stories: a reply with a
// widget shows it in its own frame, in the app's colours, sized to its content, cut off from the app's storage and from
// the network; a widget of the library (~/.claude/widgets, a temp folder here) shows with the reply's data, and a
// missing one says so; tapping a widget's button sends its prompt in the chat, while a widget cannot act by itself
// (even right after a tap on Send); a heavy action asks in the chat first and runs only when allowed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { launchChrome, lastAnswer, openProject, pairedPage, phone, send, startBackend, type Backend } from './harness.ts'

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

// A paired phone in a new session of the project folder.
async function chat(): Promise<Page> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await openProject(page)
  return page
}

const frame = (page: Page) => lastAnswer(page).frameLocator('iframe.widget-frame')

describe('PWA chat widgets (fake SDK)', () => {
  it('an inline widget runs in its frame: themed, sized to its content, no storage, no network', async () => {
    const page = await chat()
    await send(page, 'widget')
    await lastAnswer(page).getByText('Tap it.').waitFor()
    await frame(page).getByRole('button', { name: 'Vai' }).waitFor()
    await frame(page).getByText('function,themed,blocked,offline,auto-refused').waitFor()
    const height = await lastAnswer(page).locator('iframe.widget-frame').evaluate((element) => element.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(60)
    expect(await lastAnswer(page).locator('pre').count()).toBe(0)
  })

  it('a library widget shows with the reply data; a missing one says so', async () => {
    mkdirSync(join(backend.claudeDir, 'widgets'), { recursive: true })
    writeFileSync(join(backend.claudeDir, 'widgets', 'echo.html'), '<meta name="description" content="Shows its text">\n<p id="out"></p>\n<script>document.getElementById("out").textContent = "data: " + athome.data.text</script>\n')
    const page = await chat()
    await send(page, 'widget echo')
    await frame(page).getByText('data: vai').waitFor()
    await send(page, 'widget nope')
    await lastAnswer(page).getByText('There is no widget named “nope” in the library.').waitFor()
  })

  it("tapping the widget's button sends its prompt in the chat", async () => {
    const page = await chat()
    await send(page, 'widget')
    await frame(page).getByRole('button', { name: 'Vai' }).click()
    await page.locator('.msg-ai').getByText('Echo: vai').waitFor()
    expect(await page.locator('.msg-ai').getByText('Echo: auto').count()).toBe(0)
  })

  it('a heavy action asks in the chat: denied, nothing happens; allowed, the project is made', async () => {
    const page = await chat()
    await send(page, 'widget')
    const widget = frame(page)
    await widget.getByRole('button', { name: 'Nuovo progetto' }).click()
    const card = page.getByRole('region', { name: 'A widget asks' })
    await card.getByText(`Create the project “idea” in ${backend.root}?`).waitFor()
    await card.getByRole('button', { name: 'No', exact: true }).click()
    await widget.getByText('refused', { exact: true }).waitFor()
    expect(existsSync(join(backend.root, 'idea'))).toBe(false)
    await widget.getByRole('button', { name: 'Nuovo progetto' }).click()
    await card.getByRole('button', { name: 'Yes', exact: true }).click()
    await widget.getByText(`made ${join(backend.root, 'idea')}`).waitFor()
    expect(existsSync(join(backend.root, 'idea'))).toBe(true)
  })
})

// The chat widget's action round trip on WebKit (Safari's engine), to reproduce an iPhone report: the tap reaches
// the widget but the app's answer never comes back. Same scenario as widgets.e2e.ts "tapping the widget's button".
// Run by hand: CLAUDE_WRAP_E2E_WEBKIT=1 npx vitest run --config apps/mobile/vitest.e2e.config.ts apps/mobile/e2e/widgets-webkit.e2e.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { webkit, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { lastAnswer, openProject, pairedPage, send, startBackend, type Backend } from './harness.ts'

let browser: Browser
let backend: Backend
let contexts: BrowserContext[] = []

// CLAUDE_WRAP_E2E_WEBKIT: '1' for the version playwright-core expects, or the path of a pw_run.sh of another build.
const executablePath = process.env.CLAUDE_WRAP_E2E_WEBKIT && process.env.CLAUDE_WRAP_E2E_WEBKIT !== '1' ? process.env.CLAUDE_WRAP_E2E_WEBKIT : undefined
beforeAll(async () => (browser = await webkit.launch(executablePath ? { executablePath } : {})))
afterAll(() => browser.close())
beforeEach(async () => (backend = await startBackend()))
afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()))
  contexts = []
  await backend.stop()
})

async function chat(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' })
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await openProject(page)
  return page
}

describe.runIf(Boolean(process.env.CLAUDE_WRAP_E2E_WEBKIT))('PWA chat widgets on WebKit', () => {
  it("the widget renders and tapping its button sends its prompt", async () => {
    const page = await chat()
    page.on('console', (message) => console.log('[page]', message.type(), message.text()))
    await send(page, 'widget')
    const frame = lastAnswer(page).frameLocator('iframe.widget-frame')
    await frame.getByText(/^function,/).waitFor()
    console.log('probe:', await frame.locator('#probe').textContent())
    await frame.getByRole('button', { name: 'Vai' }).click()
    await page.waitForTimeout(3000)
    console.log('dataset:', await frame.locator('body').evaluate((body) => JSON.stringify((body as HTMLElement).dataset)))
    await page.locator('.msg-ai').getByText('Echo: vai').waitFor({ timeout: 10_000 })
    expect(true).toBe(true)
  })
})

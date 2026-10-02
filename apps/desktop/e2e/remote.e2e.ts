// Phase 3c, the desktop on a remote server (real server in the test process, scripted fake SDKs). User stories:
// I add my server by pasting a pairing link; I switch between This PC and the server and work on both; a session
// waiting on the hidden backend shows a dot on its switcher button; the server stays paired after a restart;
// removing it forgets it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { launch, lastAnswer, send, type App } from './harness.ts'
import { startTestServer, type TestServer } from './server.ts'

let ctx: App
let remote: TestServer

// Adds the server through the Servers… panel with a fresh pairing link.
async function addServer(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Servers…' }).click()
  const panel = page.getByRole('region', { name: 'Servers' })
  await panel.getByRole('textbox', { name: 'Link or code' }).fill(await remote.pairingLink())
  await panel.getByRole('textbox', { name: 'Name (optional)' }).fill(name)
  await panel.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name, exact: true }).waitFor()
}

// On the server's start screen: browse to `project`, trust it, open a new session.
async function openProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'project' }).click()
  await page.getByRole('button', { name: /^Use / }).click()
  const trust = page.getByRole('button', { name: 'Yes, I trust it' })
  const newSession = page.getByRole('button', { name: 'New session' })
  await trust.or(newSession).first().waitFor()
  if (await trust.isVisible()) await trust.click()
  await newSession.click()
  await page.getByRole('textbox', { name: 'Message to Claude' }).waitFor()
}

beforeEach(async () => {
  remote = await startTestServer()
  ctx = await launch()
})
afterEach(async () => {
  await ctx.close()
  await remote.stop()
})

describe('desktop on a remote server (fake SDK)', () => {
  it('pairs from a pasted link, chats on the server, and shows a dot when the hidden backend waits', async () => {
    const { page } = ctx
    await addServer(page, 'Home server')
    await page.getByRole('button', { name: 'Home server', exact: true }).click()
    await openProject(page)
    await send(page, 'hello server')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello server')
    // Back on This PC, a session of the server starts waiting for an answer (asked from another device).
    await page.getByRole('button', { name: 'This PC' }).click()
    const phone = await remote.client('phone')
    const cwd = `${remote.root}${remote.root.includes('\\') ? '\\' : '/'}project`
    await phone.request('tab.create', { tabId: 'from-phone', cwd })
    await phone.request('tab.send', { tabId: 'from-phone', text: 'permission' })
    // The dot's label joins the button's name: "Home server Claude is waiting for you".
    await page.getByRole('button', { name: 'Home server Claude is waiting for you' }).waitFor()
  })

  it('a wrong link is refused with a clear message', async () => {
    const { page } = ctx
    await page.getByRole('button', { name: 'Servers…' }).click()
    const panel = page.getByRole('region', { name: 'Servers' })
    await panel.getByRole('textbox', { name: 'Link or code' }).fill('https://example.com/no-code')
    await panel.getByRole('button', { name: 'Add server' }).click()
    await expect.poll(() => panel.getByRole('alert').textContent()).toBe('Not a pairing link: it looks like https://server:8443/#pair=…')
    await panel.getByRole('textbox', { name: 'Link or code' }).fill(`${remote.url}/#pair=expired`)
    await panel.getByRole('button', { name: 'Add server' }).click()
    await expect.poll(() => panel.getByRole('alert').textContent()).toBe('Unknown or expired code: ask for a new one.')
  })

  it('stays paired after a restart, and removing the server forgets it', async () => {
    await addServer(ctx.page, 'Home server')
    await ctx.page.getByRole('button', { name: 'Home server', exact: true }).click()
    await openProject(ctx.page)
    await ctx.quit()
    ctx = await launch(ctx.stateDir)
    const { page } = ctx
    // The server was the shown backend: it comes back connected, with its session.
    await page.getByRole('tab', { name: /project/ }).waitFor()
    await page.getByRole('button', { name: 'Servers…' }).click()
    const panel = page.getByRole('region', { name: 'Servers' })
    await panel.getByRole('button', { name: 'Remove' }).click()
    await panel.getByRole('button', { name: 'Confirm remove' }).click()
    await page.getByRole('button', { name: 'Home server', exact: true }).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'This PC' }).waitFor()
  })
})

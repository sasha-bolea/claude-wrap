// Phase 3c, the desktop on a remote server (real server in the test process, scripted fake SDKs). User stories:
// I add my server by pasting a pairing link; I switch between This PC and the server from a drop-down and work on
// both; a session waiting on the hidden backend shows a dot on the drop-down and on it in the menu; I rename the
// server; it stays paired after a restart; removing it forgets it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { composer, launch, lastAnswer, openRows, send, showSessions, type App } from './harness.ts'
import { startTestServer, type TestServer } from './server.ts'

let ctx: App
let remote: TestServer

// The drop-down of the shown backend (its label names it).
const picker = (page: Page) => page.getByRole('button', { name: /^Shown: / })

// Shows a backend (This PC or a server's name) from the drop-down's menu.
async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click()
  await page.getByRole('radiogroup', { name: 'Backends' }).getByRole('radio', { name }).click()
  await page.getByRole('button', { name: `Shown: ${name}. Change` }).waitFor()
}

// The Servers… sheet.
const serversSheet = (page: Page) => page.getByRole('dialog', { name: 'Servers' })

// Opens Servers… from the drop-down's menu.
async function openServers(page: Page): Promise<void> {
  await picker(page).click()
  await page.getByRole('button', { name: 'Servers…' }).click()
}

// Adds the server through the Servers… sheet with a fresh pairing link, and waits for it in the drop-down's menu.
async function addServer(page: Page, name: string): Promise<void> {
  await openServers(page)
  const sheet = serversSheet(page)
  await sheet.getByRole('textbox', { name: 'Link or code' }).fill(await remote.pairingLink())
  await sheet.getByRole('textbox', { name: 'Name (optional)' }).fill(name)
  await sheet.getByRole('button', { name: 'Add server' }).click()
  await sheet.waitFor({ state: 'detached' })
  await picker(page).click()
  await page.getByRole('radiogroup', { name: 'Backends' }).getByRole('radio', { name }).waitFor()
  await page.keyboard.press('Escape')
}

// On the server's Home: a new session in its `project` folder (from the folder's menu), trusting it if asked.
async function openProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Actions for the folder project' }).click()
  await page.locator('.sheet').getByRole('button', { name: 'New session here' }).click()
  const trust = page.getByRole('button', { name: 'Yes, I trust it' })
  const opened = page.locator('.col-left .row').filter({ hasText: 'project' }).locator('.folder-status')
  await trust.or(opened).first().waitFor()
  if (await trust.isVisible()) await trust.click()
  await composer(page).waitFor()
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
    await choose(page, 'Home server')
    await openProject(page)
    await send(page, 'hello server')
    await expect.poll(() => lastAnswer(page).textContent()).toBe('Echo: hello server')
    // Back on This PC, a session of the server starts waiting for an answer (asked from another device): a dot on the
    // drop-down, and on the server in its menu.
    await choose(page, 'This PC')
    const phone = await remote.client('phone')
    const cwd = `${remote.root}${remote.root.includes('\\') ? '\\' : '/'}project`
    await phone.request('tab.create', { tabId: 'from-phone', cwd })
    await phone.request('tab.send', { tabId: 'from-phone', text: 'permission' })
    await picker(page).locator('.switch-dot').waitFor()
    await picker(page).click()
    await page.getByRole('radiogroup', { name: 'Backends' }).getByRole('radio', { name: 'Home server' }).locator('.switch-dot').waitFor()
  })

  it('a server is renamed from Servers…: the drop-down shows the new name, also after a restart', async () => {
    await addServer(ctx.page, 'Home server')
    await choose(ctx.page, 'Home server')
    await openServers(ctx.page)
    await serversSheet(ctx.page).getByRole('button', { name: 'Rename Home server' }).click()
    const field = ctx.page.getByRole('dialog', { name: 'Rename' }).getByRole('textbox', { name: 'New name' })
    expect(await field.inputValue()).toBe('Home server')
    await field.fill('Casa')
    await ctx.page.keyboard.press('Enter')
    await ctx.page.getByRole('button', { name: 'Shown: Casa. Change' }).waitFor()
    await ctx.quit()
    ctx = await launch(ctx.stateDir)
    await ctx.page.getByRole('button', { name: 'Shown: Casa. Change' }).waitFor()
  })

  it('a wrong link is refused with a clear message', async () => {
    const { page } = ctx
    await openServers(page)
    const panel = serversSheet(page)
    await panel.getByRole('textbox', { name: 'Link or code' }).fill('https://example.com/no-code')
    await panel.getByRole('button', { name: 'Add server' }).click()
    await expect.poll(() => panel.getByRole('alert').textContent()).toBe('Not a pairing link: it looks like https://server:8443/#pair=…')
    await panel.getByRole('textbox', { name: 'Link or code' }).fill(`${remote.url}/#pair=expired`)
    await panel.getByRole('button', { name: 'Add server' }).click()
    await expect.poll(() => panel.getByRole('alert').textContent()).toBe('Unknown or expired code: ask for a new one.')
  })

  it('stays paired after a restart, and removing the server forgets it', async () => {
    await addServer(ctx.page, 'Home server')
    await choose(ctx.page, 'Home server')
    await openProject(ctx.page)
    await ctx.quit()
    ctx = await launch(ctx.stateDir)
    const { page } = ctx
    // The server was the shown backend: it comes back connected, with its session.
    await showSessions(page)
    await expect.poll(() => openRows(page).count()).toBe(1)
    await openServers(page)
    const panel = serversSheet(page)
    await panel.getByRole('button', { name: 'Remove' }).click()
    await panel.getByRole('button', { name: 'Confirm remove' }).click()
    await page.getByRole('button', { name: 'Shown: This PC. Change' }).waitFor()
    await picker(page).click()
    await page.getByRole('radiogroup', { name: 'Backends' }).getByRole('radio', { name: 'This PC' }).waitFor()
    expect(await page.getByRole('radiogroup', { name: 'Backends' }).getByRole('radio', { name: 'Home server' }).count()).toBe(0)
  })
})

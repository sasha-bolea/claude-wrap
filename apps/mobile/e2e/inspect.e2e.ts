// The native Status, MCP servers and Hooks panels in the PWA on the scripted fake SDK (every fake process has the same
// data: see scriptInspection in packages/core/src/testing/scenarios.ts). User stories: from the chat's ⋯ menu I read the
// session's status and its settings files; I see the three MCP servers with their state, enable a disabled one, and sign
// in to the one that needs it (a refused sign-in shows its reason, a good one connects it); I see the configured hooks
// and the latest run with its output; from Settings I pick a session to open a panel.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import { button, launchChrome, openProject, pairedPage, phone, send, startBackend, type Backend } from './harness.ts'

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

// From the chat: ⋯ → the panel's entry (Status, MCP servers or Hooks); returns the panel's screen.
async function openPanel(page: Page, name: 'Status' | 'MCP servers' | 'Hooks'): Promise<Locator> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.locator('.sheet').getByRole('button', { name: new RegExp(`^${name}`) }).click()
  const screen = page.getByRole('region', { name, exact: true })
  await screen.waitFor()
  return screen
}

// The row of an MCP server in the panel.
const serverRow = (screen: Locator, name: string) => screen.locator('.row').filter({ has: screen.page().getByText(name, { exact: true }) })

describe('PWA inspection panels (fake SDK)', () => {
  it('⋯ → Status: the CLI sections and the settings files in effect', async () => {
    const page = await chat()
    const screen = await openPanel(page, 'Status')
    await screen.getByText('Session', { exact: true }).waitFor()
    await screen.getByText('Environment', { exact: true }).waitFor()
    await screen.getByText('Version', { exact: true }).waitFor()
    await screen.getByText('2.1.287', { exact: true }).waitFor()
    await screen.getByText('Model', { exact: true }).waitFor()
    await screen.getByText('fake-model', { exact: true }).waitFor()
    await screen.getByText('/home/user/.claude/settings.json').waitFor()
    await screen.getByText('/work/.claude/settings.json').waitFor()
    await screen.getByRole('button', { name: 'Read again' }).click()
    await screen.getByText('2.1.287', { exact: true }).waitFor()
  })

  it('⋯ → MCP servers: three servers with their state; Enable turns the disabled one on', async () => {
    const page = await chat()
    const screen = await openPanel(page, 'MCP servers')
    await serverRow(screen, 'tiny').getByText('Connected', { exact: true }).waitFor()
    await serverRow(screen, 'tiny').getByText('project · 1 tool').waitFor()
    await serverRow(screen, 'remote').getByText('Needs sign-in', { exact: true }).waitFor()
    await serverRow(screen, 'off').getByText('Disabled', { exact: true }).waitFor()
    expect(await screen.locator('.list > .row').count()).toBe(3)
    await serverRow(screen, 'off').getByRole('button').first().click()
    await button(page, /^Enable/).waitFor()
    await page.locator('.sheet').getByText('Applies to this folder, also for the next sessions').waitFor()
    // A disabled server has nothing to reconnect or sign in to.
    expect(await page.locator('.sheet').getByRole('button', { name: 'Reconnect', exact: true }).count()).toBe(0)
    await button(page, /^Enable/).click()
    await serverRow(screen, 'off').getByText('Connected', { exact: true }).waitFor()
  })

  it('MCP sign-in: a refused address shows why, an address with a code connects the server', async () => {
    const page = await chat()
    const screen = await openPanel(page, 'MCP servers')
    await serverRow(screen, 'remote').getByRole('button').first().click()
    await button(page, 'Sign in').click()
    const sheet = page.locator('.sheet')
    await sheet.getByText('Sign in to remote').waitFor()
    await sheet.getByRole('button', { name: 'Open the sign-in page' }).waitFor()
    const address = sheet.getByRole('textbox', { name: 'Address of the page that does not load' })
    await address.fill('http://localhost:3118/callback?error=access_denied')
    await button(page, 'Send').click()
    await expect.poll(() => sheet.getByRole('alert').textContent()).toContain('OAuth error: access_denied')
    await serverRow(screen, 'remote').getByText('Needs sign-in', { exact: true }).waitFor()
    await address.fill('http://localhost:3118/callback?code=abc&state=x')
    await button(page, 'Send').click()
    await serverRow(screen, 'remote').getByText('Connected', { exact: true }).waitFor()
    await sheet.waitFor({ state: 'detached' })
  })

  it('⋯ → Hooks: the configured hooks by event and the latest run, whose output opens in a sheet', async () => {
    const page = await chat()
    const screen = await openPanel(page, 'Hooks')
    await screen.getByText('SessionStart', { exact: true }).first().waitFor()
    await screen.getByText('PreToolUse', { exact: true }).waitFor()
    await screen.getByText('Bash', { exact: true }).waitFor()
    await screen.getByText('All', { exact: true }).waitFor()
    await screen.getByText('Latest runs', { exact: true }).waitFor()
    const run = screen.locator('.row').filter({ has: page.getByText('Done', { exact: true }) })
    await run.getByText('Done', { exact: true }).waitFor()
    expect(await run.count()).toBe(1)
    await run.getByRole('button').click()
    const sheet = page.locator('.sheet')
    await sheet.getByText('Output', { exact: true }).waitFor()
    await expect.poll(() => sheet.locator('pre.local-output').first().textContent()).toBe('hello-hook\n')
  })

  it('Settings → Claude Code → MCP servers → Choose a session: the picked chat\'s MCP panel opens', async () => {
    const page = await chat()
    // A session with no message is dropped when you leave it: send one first.
    await send(page, 'hello')
    await page.getByText('Echo: hello').waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'MCP servers', exact: true }).click()
    await page.locator('.sheet').getByText('Choose a session').first().waitFor()
    await page.locator('.sheet .row-main').filter({ hasText: 'project' }).first().click()
    const screen = page.getByRole('region', { name: 'MCP servers', exact: true })
    await serverRow(screen, 'tiny').getByText('Connected', { exact: true }).waitFor()
  })
})

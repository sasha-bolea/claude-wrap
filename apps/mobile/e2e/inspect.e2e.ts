// The native Status, MCP servers, Hooks and Permissions panels in the PWA on the scripted fake SDK (every fake process has the same
// data: see scriptInspection in packages/core/src/testing/scenarios.ts). User stories: from the chat's ⋯ menu I read the
// session's status and its settings files; I see the three MCP servers with their state, enable a disabled one, and sign
// in to the one that needs it (a refused sign-in shows its reason, a good one connects it); I see the configured hooks
// and the latest run with its output; from Settings I pick a session to open a panel; in Permissions I read the rules
// written in the folder's settings file, add one (into the local or the project file), remove it after a confirmation,
// see a refused rule's reason, and add an extra folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

// From the chat: ⋯ → the panel's entry (Status, MCP servers, Hooks or Permissions); returns the panel's screen.
async function openPanel(page: Page, name: 'Status' | 'MCP servers' | 'Hooks' | 'Permissions'): Promise<Locator> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.locator('.sheet').getByRole('button', { name: new RegExp(`^${name}`) }).click()
  const screen = page.getByRole('region', { name, exact: true })
  await screen.waitFor()
  return screen
}

// Taps a tab of the Permissions panel by its label and count (a tap on the label, as a finger does).
const tab = (screen: Locator, name: string) => screen.locator('.segmented label').filter({ hasText: name }).click()

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

  // The project folder's settings files, which the fake SDK reads like the real CLI does.
  const settingsFile = (name: 'settings.json' | 'settings.local.json') => join(backend.root, 'project', '.claude', name)
  const storedRules = (name: 'settings.json' | 'settings.local.json', behavior: string): string[] => (existsSync(settingsFile(name)) ? JSON.parse(readFileSync(settingsFile(name), 'utf8')).permissions?.[behavior] ?? [] : [])

  it('⋯ → Permissions: rules by tab with their source; add (local and project), a refused rule, remove after asking', async () => {
    mkdirSync(join(backend.root, 'project', '.claude'))
    writeFileSync(settingsFile('settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)', 'Read\u200b(x)'], deny: ['Read(./.env)'] } }))
    const page = await chat()
    const screen = await openPanel(page, 'Permissions')
    const row = (text: string) => screen.locator('.row').filter({ has: page.getByText(text, { exact: true }) })
    await screen.getByRole('radio', { name: 'Allow 2' }).waitFor()
    await screen.getByRole('radio', { name: 'Ask 0' }).waitFor()
    await screen.getByRole('radio', { name: 'Deny 1' }).waitFor()
    await screen.getByText('Deny wins over ask, and ask over allow.').waitFor()
    await row('Bash(ls:*)').getByText('You, this folder', { exact: true }).waitFor()
    // An invisible character in a rule is spelled out.
    await row('Read\\u{200B}(x)').waitFor()
    await tab(screen, 'Ask 0')
    await screen.getByText('No ask rules.').waitFor()
    await tab(screen, 'Deny 1')
    await row('Read(./.env)').waitFor()

    // Add into this folder's local file (the default destination).
    await tab(screen, 'Allow 2')
    await screen.getByRole('button', { name: 'Add rule', exact: true }).click()
    const sheet = page.locator('.sheet')
    await sheet.getByText('A tool or Tool(content), e.g. Read, WebFetch(domain:example.com)').waitFor()
    await sheet.getByText('.claude/settings.local.json').waitFor()
    const field = sheet.getByRole('textbox', { name: 'Rule' })
    // A refused rule stays in the sheet with the reason.
    await field.fill('not a rule!')
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.poll(() => sheet.getByRole('alert').textContent()).toContain('not a permission rule')
    await field.fill('WebFetch(domain:example.com)')
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    await row('WebFetch(domain:example.com)').getByText('You, this folder', { exact: true }).waitFor()
    await screen.getByRole('radio', { name: 'Allow 3' }).waitFor()
    expect(storedRules('settings.local.json', 'allow')).toContain('WebFetch(domain:example.com)')

    // Add into the project file.
    await screen.getByRole('button', { name: 'Add rule', exact: true }).click()
    await sheet.getByRole('textbox', { name: 'Rule' }).fill('Edit')
    await sheet.getByRole('radio', { name: /^Project/ }).click()
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    await row('Edit').getByText('Project', { exact: true }).waitFor()
    expect(storedRules('settings.json', 'allow')).toEqual(['Edit'])

    // Remove: the confirmation names the rule and its file; Cancel keeps it, Remove takes it out.
    await screen.getByRole('button', { name: 'Remove rule WebFetch(domain:example.com)' }).click()
    await sheet.getByText('It is removed from .claude/settings.local.json.').waitFor()
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await sheet.waitFor({ state: 'detached' })
    expect(storedRules('settings.local.json', 'allow')).toContain('WebFetch(domain:example.com)')
    await screen.getByRole('button', { name: 'Remove rule WebFetch(domain:example.com)' }).click()
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    await row('WebFetch(domain:example.com)').waitFor({ state: 'detached' })
    expect(storedRules('settings.local.json', 'allow')).not.toContain('WebFetch(domain:example.com)')
  })

  it('Permissions → Folders: the session folder, then an added folder that can be removed', async () => {
    const page = await chat()
    const screen = await openPanel(page, 'Permissions')
    await tab(screen, 'Folders 1')
    await screen.getByText('Session folder', { exact: true }).waitFor()
    await screen.getByText('No extra folders.').waitFor()
    expect(await screen.getByRole('button', { name: /^Remove folder/ }).count()).toBe(0)
    await screen.getByRole('button', { name: 'Add folder', exact: true }).click()
    const sheet = page.locator('.sheet')
    await sheet.getByText('Absolute, ~/… or relative to the session folder').waitFor()
    // A folder that does not exist is refused in the sheet.
    await sheet.getByRole('textbox', { name: 'Folder path' }).fill('nowhere-at-all')
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.poll(() => sheet.getByRole('alert').textContent()).toContain('not a folder')
    mkdirSync(join(backend.root, 'project', 'docs'))
    await sheet.getByRole('textbox', { name: 'Folder path' }).fill('docs')
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    const added = join(backend.root, 'project', 'docs')
    await screen.getByText(added, { exact: true }).waitFor()
    await screen.getByRole('radio', { name: 'Folders 2' }).waitFor()
    await screen.getByRole('button', { name: `Remove folder ${added}` }).click()
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    await screen.getByText(added, { exact: true }).waitFor({ state: 'detached' })
    await screen.getByText('No extra folders.').waitFor()
  })

  it('Settings → Claude Code → Permissions → Choose a session: the picked chat\'s permissions open', async () => {
    const page = await chat()
    await send(page, 'hello')
    await page.getByText('Echo: hello').waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Permissions', exact: true }).click()
    await page.locator('.sheet').getByText('Choose a session').first().waitFor()
    await page.locator('.sheet .row-main').filter({ hasText: 'project' }).first().click()
    const screen = page.getByRole('region', { name: 'Permissions', exact: true })
    await screen.getByRole('radio', { name: 'Allow 0' }).waitFor()
    await screen.getByText('No allow rules.').waitFor()
  })
})

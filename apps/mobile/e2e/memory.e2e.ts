// The native Memory panel (/memory) in the PWA on the scripted fake SDK, whose memory dialog lists files in temp folders
// (MemoryFixture in harness.ts; never the real ~/.claude). User stories: from the chat's ⋯ menu I see the instruction
// files the session loads (one not created yet) and the saved memories, the index first and the newest memory above the
// older one; I edit an instruction file and save it, and create the one that does not exist; saving a file that
// changed on disk meanwhile is refused with a Reload; leaving with unsaved changes asks first; a saved memory opens
// read only; deleting one asks first, moves it to the trash and takes it out of the index; the auto-memory switch
// writes autoMemoryEnabled into the user's settings file; from Settings I pick a session to open the panel.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// A paired phone in a new session of the project folder, on the Memory panel (⋯ → Memory).
async function openMemory(): Promise<{ page: Page; screen: Locator }> {
  const context = await phone(browser)
  contexts.push(context)
  const page = await pairedPage(context, backend)
  await openProject(page)
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.locator('.sheet').getByRole('button', { name: /^Memory/ }).click()
  const screen = page.getByRole('region', { name: 'Memory', exact: true })
  await screen.getByText('User memory', { exact: true }).waitFor()
  return { page, screen }
}

// A row of the panel by its title (a file's label or a memory's name).
const row = (screen: Locator, title: string) => screen.locator('.row').filter({ has: screen.page().getByText(title, { exact: true }) })

// Opens an instruction file's editor from the panel; returns the editor screen.
async function openFile(page: Page, screen: Locator, label: string): Promise<Locator> {
  await row(screen, label).getByRole('button').first().click()
  const editor = page.getByRole('region', { name: label, exact: true })
  await editor.getByRole('textbox', { name: 'Text of the file' }).waitFor()
  return editor
}

describe('PWA Memory panel (fake SDK)', () => {
  it('⋯ → Memory: the instruction files, the one not created yet, the index first, newest memory first', async () => {
    const { screen } = await openMemory()
    await screen.getByText('Instruction files', { exact: true }).waitFor()
    await screen.getByText(backend.memory.user, { exact: true }).waitFor()
    await screen.getByText('Changes reach the sessions you start afterwards.').waitFor()
    await row(screen, 'Local memory').getByText('Not created yet').waitFor()
    expect(await row(screen, 'User memory').getByText('Not created yet').count()).toBe(0)
    expect(await screen.getByRole('checkbox', { name: /^Use auto memory/ }).isChecked()).toBe(true)
    await screen.getByText(`${backend.memory.dir}/`, { exact: true }).waitFor()
    // Index (MEMORY.md) first, then tabs.md (October) above repo.md (September).
    const memories = screen.locator('.group').nth(1).locator('.list').nth(1).locator('.row-title')
    expect(await memories.allTextContents()).toEqual(['Index', 'tabs.md', 'repo.md'])
    await row(screen, 'tabs.md').getByText('feedback', { exact: true }).waitFor()
    await row(screen, 'repo.md').getByText('project', { exact: true }).waitFor()
    await row(screen, 'tabs.md').getByText('Prefers tabs').waitFor()
    // The index cannot be deleted; the others can.
    expect(await row(screen, 'Index').getByRole('button').count()).toBe(1)
    expect(await row(screen, 'tabs.md').getByRole('button').count()).toBe(2)
  })

  it('edits an instruction file and saves it: the text is on disk', async () => {
    const { page, screen } = await openMemory()
    const editor = await openFile(page, screen, 'User memory')
    await editor.getByText(backend.memory.user, { exact: true }).waitFor()
    const field = editor.getByRole('textbox', { name: 'Text of the file' })
    expect(await field.inputValue()).toBe('# Mine\n')
    // Nothing to save until something changes.
    expect(await editor.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)
    await field.fill('# Mine\nI like tabs.\n')
    await editor.getByText('Unsaved changes', { exact: true }).waitFor()
    await editor.getByRole('button', { name: 'Save' }).click()
    await page.getByText('File saved', { exact: true }).waitFor()
    await editor.getByText('Unsaved changes', { exact: true }).waitFor({ state: 'detached' })
    expect(readFileSync(backend.memory.user, 'utf8')).toBe('# Mine\nI like tabs.\n')
    // The version moved on: a second save goes through.
    await field.fill('# Mine\nSecond.\n')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => readFileSync(backend.memory.user, 'utf8')).toBe('# Mine\nSecond.\n')
  })

  it('creates the file that does not exist yet', async () => {
    const { page, screen } = await openMemory()
    expect(existsSync(backend.memory.local)).toBe(false)
    const editor = await openFile(page, screen, 'Local memory')
    await editor.getByText('This file does not exist yet: Save creates it.').waitFor()
    const field = editor.getByRole('textbox', { name: 'Text of the file' })
    expect(await field.inputValue()).toBe('')
    await field.fill('Only mine.\n')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => existsSync(backend.memory.local) && readFileSync(backend.memory.local, 'utf8')).toBe('Only mine.\n')
    await editor.getByText('This file does not exist yet: Save creates it.').waitFor({ state: 'detached' })
    // Back on the panel the file is no longer "not created yet".
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await screen.getByText('Local memory', { exact: true }).waitFor()
    await row(screen, 'Local memory').getByText('Not created yet').waitFor({ state: 'detached' })
  })

  it('a file changed on disk meanwhile is refused with Reload, and nothing is overwritten', async () => {
    const { page, screen } = await openMemory()
    const editor = await openFile(page, screen, 'User memory')
    const field = editor.getByRole('textbox', { name: 'Text of the file' })
    await field.fill('# Mine\nMy edit.\n')
    writeFileSync(backend.memory.user, '# Changed elsewhere, longer than before\n')
    await editor.getByRole('button', { name: 'Save' }).click()
    await editor.getByRole('alert').getByText('This file changed meanwhile. Reload it, then make your change again.').waitFor()
    expect(readFileSync(backend.memory.user, 'utf8')).toBe('# Changed elsewhere, longer than before\n')
    await editor.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => field.inputValue()).toBe('# Changed elsewhere, longer than before\n')
    await editor.getByRole('alert').waitFor({ state: 'detached' })
    // After reloading, saving works again.
    await field.fill('# Mine\nMy edit, again.\n')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => readFileSync(backend.memory.user, 'utf8')).toBe('# Mine\nMy edit, again.\n')
  })

  it('leaving with unsaved changes asks: keep editing stays, discard leaves without writing', async () => {
    const { page, screen } = await openMemory()
    const editor = await openFile(page, screen, 'User memory')
    await editor.getByRole('textbox', { name: 'Text of the file' }).fill('# Not saved\n')
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await page.locator('.sheet').getByText('Discard your changes?').first().waitFor()
    await button(page, 'Keep editing').click()
    await editor.getByRole('textbox', { name: 'Text of the file' }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await button(page, 'Discard').click()
    await screen.getByText('Instruction files', { exact: true }).waitFor()
    expect(readFileSync(backend.memory.user, 'utf8')).toBe('# Mine\n')
    // An untouched file leaves without asking.
    const again = await openFile(page, screen, 'User memory')
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await again.waitFor({ state: 'hidden' })
    expect(await page.locator('.sheet').count()).toBe(0)
  })

  it('an imported file says it may live in a git repository', async () => {
    const { page, screen } = await openMemory()
    const imported = await openFile(page, screen, 'L imported.md')
    await imported.getByText('This file is imported by another instruction file; if it lives in a git repository, commit the change there.').waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    const user = await openFile(page, screen, 'User memory')
    expect(await user.getByText('imported by another instruction file', { exact: false }).count()).toBe(0)
  })

  it('opens a saved memory read only', async () => {
    const { page, screen } = await openMemory()
    await row(screen, 'tabs.md').getByRole('button').first().click()
    const viewer = page.getByRole('region', { name: 'tabs.md', exact: true })
    await viewer.getByText('Read only', { exact: true }).waitFor()
    await viewer.getByText('Use tabs, not spaces.', { exact: false }).waitFor()
    await viewer.getByText(backend.memory.tabs, { exact: true }).waitFor()
    expect(await viewer.getByRole('textbox').count()).toBe(0)
    // The index opens the same way, under its own name.
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await row(screen, 'Index').getByRole('button').first().click()
    await page.getByRole('region', { name: 'Index', exact: true }).getByText('- [Tabs](tabs.md)', { exact: false }).waitFor()
  })

  it('deletes a memory after asking: it leaves the list, the disk and the index', async () => {
    const { page, screen } = await openMemory()
    await screen.getByRole('button', { name: 'Delete memory tabs.md' }).click()
    await page.locator('.sheet').getByText('Delete this memory?').first().waitFor()
    await page.locator('.sheet').getByText('It goes to the trash.').waitFor()
    // Cancel leaves it.
    await button(page, 'Cancel').click()
    expect(existsSync(backend.memory.tabs)).toBe(true)
    await screen.getByRole('button', { name: 'Delete memory tabs.md' }).click()
    await button(page, 'Delete').click()
    await page.getByText('Memory deleted', { exact: true }).waitFor()
    await row(screen, 'tabs.md').waitFor({ state: 'detached' })
    expect(existsSync(backend.memory.tabs)).toBe(false)
    const index = readFileSync(backend.memory.index, 'utf8')
    expect(index).not.toContain('](tabs.md)')
    expect(index).toContain('](repo.md)')
    await row(screen, 'repo.md').waitFor()
  })

  it('auto memory off writes autoMemoryEnabled: false into the user settings file', async () => {
    const { screen } = await openMemory()
    const switchRow = screen.getByRole('checkbox', { name: /^Use auto memory/ })
    await switchRow.uncheck()
    const settings = join(backend.claudeDir, 'settings.json')
    await expect.poll(() => existsSync(settings) && JSON.parse(readFileSync(settings, 'utf8')).autoMemoryEnabled).toBe(false)
    await expect.poll(() => switchRow.isChecked()).toBe(false)
    await switchRow.check()
    await expect.poll(() => JSON.parse(readFileSync(settings, 'utf8')).autoMemoryEnabled).toBe(true)
  })

  it('a folder with no saved memories says so', async () => {
    for (const file of [backend.memory.index, backend.memory.tabs, backend.memory.repo]) rmSync(file)
    const { screen } = await openMemory()
    await screen.getByText('No saved memories yet.').waitFor()
    expect(await screen.getByRole('button', { name: /^Delete memory/ }).count()).toBe(0)
    // The switch and the folder stay.
    await screen.getByRole('checkbox', { name: /^Use auto memory/ }).waitFor()
  })

  it('Settings → Claude Code → Memory → Choose a session: the picked chat\'s memory opens', async () => {
    const context = await phone(browser)
    contexts.push(context)
    const page = await pairedPage(context, backend)
    await openProject(page)
    await send(page, 'hello')
    await page.getByText('Echo: hello').waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Memory', exact: true }).click()
    await page.locator('.sheet').getByText('Choose a session').first().waitFor()
    await page.locator('.sheet .row-main').filter({ hasText: 'project' }).first().click()
    const screen = page.getByRole('region', { name: 'Memory', exact: true })
    await screen.getByText('User memory', { exact: true }).waitFor()
  })
})

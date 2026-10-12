import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'

const DESKTOP_DIR = join(import.meta.dirname, '..')
// The `electron` package resolves to the path of its binary when required from Node.
const ELECTRON_PATH = createRequire(import.meta.url)('electron') as unknown as string

export type App = { app: ElectronApplication; page: Page; stateDir: string; projectDir: string; close(): Promise<void>; quit(): Promise<void> }

// A fresh project folder (removed with the app's temp state by cleanup()).
export function makeFolder(name = 'project'): string {
  const folder = join(mkdtempSync(join(tmpdir(), 'cw-e2e-project-')), name)
  mkdirSync(folder)
  return folder
}

// Makes the native folder dialog return this folder next time.
export async function nextFolder(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
  }, folder)
}

// Launches the built desktop app on the scripted fake SDK, with its own state folder and English UI.
// stateDir: reuse a previous run's state (restart tests). The folder dialog returns a fresh project folder.
export async function launch(stateDir = mkdtempSync(join(tmpdir(), 'cw-e2e-state-'))): Promise<App> {
  const projectDir = makeFolder()
  const app = await _electron.launch({
    executablePath: ELECTRON_PATH,
    args: [DESKTOP_DIR, '--lang=en-US'],
    env: { ...process.env, CLAUDE_WRAP_FAKE_SDK: '1', CLAUDE_WRAP_STATE_DIR: stateDir }
  })
  // Linux without a keyring (xvfb): plain-text safeStorage, so a server's token can be kept (pairing tests).
  if (process.platform === 'linux') await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  await nextFolder(app, projectDir)
  const page = await app.firstWindow()
  await waitForHome(page)
  return {
    app,
    page,
    stateDir,
    projectDir,
    // Quits the app but keeps its state (restart tests).
    quit: () => app.close(),
    close: async () => {
      await app.close()
      rmSync(stateDir, { recursive: true, force: true })
    }
  }
}

// Waits for the touch app to be on screen in its wide arrangement (the window opens at 1200 px: three columns).
// page: the app's window. Returns when the Home's left column is there.
export async function waitForHome(page: Page): Promise<void> {
  await page.locator('.col-left').waitFor()
}

// Goes back to the root of This PC's Home (the list of added folders), leaving any folder entered.
// page: the app's window. Returns when "Add folder…" is shown.
export async function homeRoot(page: Page): Promise<void> {
  await showProjects(page)
  const up = page.getByRole('button', { name: /^Up: / })
  while (await up.first().isVisible()) await up.first().click()
  await page.getByRole('button', { name: 'Add folder…' }).waitFor()
}

// Adds the folder the stubbed dialog returns to This PC's Home with "Add folder…", and waits for its row.
// page: the app's window. folder: that folder (its base name must be unique among the added ones).
export async function addFolder(page: Page, folder: string): Promise<void> {
  await homeRoot(page)
  await page.getByRole('button', { name: 'Add folder…' }).click()
  await page.getByRole('button', { name: basename(folder), exact: true }).waitFor()
}

// Starts a session in a folder from its row menu (adding the folder first), trusts it if asked, and waits for its chat
// (the open session of that folder highlighted in the Home's Sessions view); the Home is left on Projects.
// page: the app's window. folder: the folder the stubbed dialog returns (nextFolder must have been set to it).
export async function openChat(page: Page, folder: string): Promise<void> {
  const name = basename(folder)
  await addFolder(page, folder)
  await page.getByRole('button', { name: `Actions for the folder ${name}` }).click()
  await page.locator('.sheet').getByRole('button', { name: 'New session here' }).click()
  const trust = page.getByRole('button', { name: 'Yes, I trust it' })
  // The chat of a previous session stays in the middle until the new one replaces it: wait for the new one to be current.
  const opened = page.locator('.col-left .row').filter({ hasText: name }).locator('.folder-status')
  await trust.or(opened).first().waitFor()
  if (await trust.isVisible()) await trust.click()
  await showSessions(page)
  await page.locator('.col-left .row.current').filter({ hasText: name }).waitFor()
  await showProjects(page)
  await composer(page).waitFor()
}

// Switches the Home's left column to its Sessions view (open and past sessions), if it is not there already.
// page: the app's window. Returns when the open sessions are listed.
export async function showSessions(page: Page): Promise<void> {
  const toggle = page.locator('.col-left').getByRole('button', { name: /^Show sessions/ })
  if (await toggle.isVisible()) await toggle.click()
  await page.locator('.col-left').getByRole('region', { name: 'Sessions' }).waitFor()
}

// Switches the Home's left column back to its Projects view (folders), if it is not there already.
// page: the app's window.
export async function showProjects(page: Page): Promise<void> {
  const toggle = page.locator('.col-left').getByRole('button', { name: 'Show projects' })
  if (await toggle.isVisible()) await toggle.click()
  await page.locator('.col-left').getByRole('region', { name: 'Sessions' }).waitFor({ state: 'detached' })
}

// The composer's text field.
export const composer = (page: Page) => page.getByRole('textbox', { name: 'Message to Claude' })

// Types a message in the composer and sends it with Enter (hardware keyboard).
export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

// Text of the last assistant message.
export const lastAnswer = (page: Page) => page.locator('.msg-ai').last()

// The open sessions listed in the Home's Sessions view (their rows; call showSessions first).
export const openRows = (page: Page) => page.locator('.col-left .row').filter({ has: page.locator('.badge') })

// Opens one of the chat's Tools: the composer's Tools button (unless they show already), back to their grid, then the
// tile. page: the app's window. name: the tile's name (its start: a tile also says its count or state).
export async function openTool(page: Page, name: string): Promise<void> {
  const tools = page.locator('.composer').getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-pressed')) !== 'true') await tools.click()
  const back = page.getByRole('button', { name: 'All tools' })
  if (await back.isVisible()) await back.click()
  await page.getByRole('region', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

// A button by its exact accessible name (the last one: a sheet's buttons come after the screen's).
export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).last()

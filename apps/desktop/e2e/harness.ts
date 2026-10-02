import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  await nextFolder(app, projectDir)
  const page = await app.firstWindow()
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

// From the start screen: choose the folder the stubbed dialog returns, trust it if asked, open a new session,
// wait for the chat. folder: that folder (the screen must show it before its buttons are trusted).
export async function openChat(page: Page, folder: string): Promise<void> {
  await page.getByRole('button', { name: /^(Choose a working folder|Change folder)$/ }).click()
  await page.locator('.start').getByText(folder, { exact: true }).first().waitFor()
  const trust = page.getByRole('button', { name: 'Yes, I trust it' })
  const newSession = page.getByRole('button', { name: 'New session' })
  await trust.or(newSession).first().waitFor()
  if (await trust.isVisible()) await trust.click()
  await newSession.click()
  await page.getByRole('textbox', { name: 'Message to Claude' }).waitFor()
}

// Types a message in the composer and sends it with Enter.
export async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: 'Message to Claude' })
  await composer.fill(text)
  await composer.press('Enter')
}

// Text of the last assistant item.
export const lastAnswer = (page: Page) => page.locator('.item.assistant-text').last()

// The tab bar's tabs.
export const tabs = (page: Page) => page.getByRole('tab')

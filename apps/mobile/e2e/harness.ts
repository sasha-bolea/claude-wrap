import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { createCore, type Core } from '@athome/core'
import { createScriptedSdk } from '@athome/core/testing'
import { DeviceStore, createPairingCode, deviceCommands, loadStaticFiles, startServer, type RunningServer, type StaticFiles } from '@athome/server'

// PWA end-to-end harness: the real server on an ephemeral port with the scripted fake SDK, serving the built PWA
// (apps/mobile/dist), and the system Chrome (playwright channel 'chrome', no browser download) at phone size.

const DIST = join(import.meta.dirname, '..', 'dist')
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// files: what the server serves (a test may swap one, e.g. a newer /version.json).
export type Backend = { url: string; root: string; stateDir: string; core: Core; server: RunningServer; devices: DeviceStore; files: StaticFiles; stop(): Promise<void> }

// Starts core + server; the session root holds a `project` folder.
export async function startBackend(): Promise<Backend> {
  const root = mkdtempSync(join(tmpdir(), 'cw-pwa-root-'))
  mkdirSync(join(root, 'project'))
  const stateDir = mkdtempSync(join(tmpdir(), 'cw-pwa-state-'))
  const devices = await DeviceStore.load(stateDir)
  let server: RunningServer | undefined
  const core = createCore({
    backendId: 'server',
    backendKind: 'remote',
    sdk: createScriptedSdk({ wordDelayMs: 20 }),
    stateDir,
    allowedRoots: [root],
    hostCommands: deviceCommands(devices, (ids) => server?.disconnect(ids), 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
  })
  const hosts: string[] = []
  const origins: string[] = []
  const files = await loadStaticFiles(DIST)
  server = await startServer({ attach: core.attach, devices, port: 0, allowedHosts: hosts, allowedOrigins: origins, files, log: () => undefined })
  const url = `http://127.0.0.1:${server.port}`
  hosts.push(`127.0.0.1:${server.port}`)
  origins.push(url)
  return { url, root, stateDir, core, server, devices, files, stop: async () => (await core.closeAll(), await server!.close()) }
}

// The system Chrome, or the browser at CLAUDE_WRAP_E2E_CHROME (e.g. Playwright's Chromium on the home server, which has
// no Chrome).
export function launchChrome(): Promise<Browser> {
  const executablePath = process.env.CLAUDE_WRAP_E2E_CHROME
  return chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
}

// A phone-sized browser context. ios: an iPhone Safari user agent (not installed → install instructions).
export function phone(browser: Browser, ios = false): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US', ...(ios ? { userAgent: IPHONE_UA } : {}) })
}

// Opens the PWA with a fresh pairing code and pairs it. Returns the page on the Home (the notifications offer after
// pairing answered "Not now").
export async function pairedPage(context: BrowserContext, backend: Backend, name = 'phone'): Promise<Page> {
  const { code } = await createPairingCode(backend.stateDir, name)
  const page = await context.newPage()
  await page.goto(`${backend.url}/#pair=${code}`)
  await page.getByRole('button', { name: 'Pair' }).click()
  await page.getByRole('button', { name: 'Not now' }).click()
  await home(page).waitFor()
  return page
}

// The Home at the server's root (its title is the root folder's name).
export const home = (page: Page) => page.getByRole('heading', { name: /^cw-pwa-root-/ })

// From the Home: new session in the `project` folder of the root (trusting it), into the chat.
export async function openProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'project', exact: true }).click()
  await page.getByRole('button', { name: 'New session in project' }).click()
  const trust = page.getByRole('button', { name: 'Yes, I trust it' })
  await trust.or(composer(page)).first().waitFor()
  if (await trust.isVisible()) await trust.click()
  await composer(page).waitFor()
}

export const composer = (page: Page) => page.getByRole('textbox', { name: 'Message to Claude' })
export const lastAnswer = (page: Page) => page.locator('.msg-ai').last()
// A button by its exact accessible name (the last one: a sheet's buttons come after the screen's).
export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).last()

// Types a message and sends it with the round send button (Enter adds a line on the phone).
export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

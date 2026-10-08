import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
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
export type Backend = { url: string; root: string; stateDir: string; claudeDir: string; memory: MemoryFixture; core: Core; server: RunningServer; devices: DeviceStore; files: StaticFiles; stop(): Promise<void> }

// The files the fake CLI's memory dialog lists for every session, all in the temp Claude config folder (never the real
// ~/.claude, and nothing inside the project folder, which the Home lists): the user and project instruction files
// (exist), the local one (not created yet), one imported by another (kind `other`),
// and the auto-memory folder with its index and two memories (tabs.md newer than repo.md).
export type MemoryFixture = { dir: string; user: string; project: string; local: string; imported: string; index: string; tabs: string; repo: string }

// Writes the fixture's files under the Claude config folder: instruction files in it and in `instructions`, memories in
// `dir`.
function writeMemoryFixture(claudeDir: string): MemoryFixture {
  const dir = join(claudeDir, 'projects', 'project', 'memory')
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(claudeDir, 'instructions'))
  const memory = (name: string) => join(dir, name)
  const fixture: MemoryFixture = { dir, user: join(claudeDir, 'CLAUDE.md'), project: join(claudeDir, 'instructions', 'CLAUDE.md'), local: join(claudeDir, 'instructions', 'CLAUDE.local.md'), imported: join(dir, 'imported.md'), index: memory('MEMORY.md'), tabs: memory('tabs.md'), repo: memory('repo.md') }
  writeFileSync(fixture.user, '# Mine\n')
  writeFileSync(fixture.project, '# Project\n')
  writeFileSync(fixture.imported, '# Imported\n')
  writeFileSync(fixture.index, '- [Tabs](tabs.md) - prefers tabs\n- [Repo](repo.md) - the repo layout\n')
  writeFileSync(fixture.tabs, '---\nname: tabs\ndescription: Prefers tabs\ntype: feedback\n---\nUse tabs, not spaces.\n')
  writeFileSync(fixture.repo, '---\nname: repo\ndescription: The repo layout\ntype: project\n---\nMonorepo with workspaces.\n')
  utimesSync(fixture.repo, new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T10:00:00Z'))
  utimesSync(fixture.tabs, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'))
  return fixture
}

// What get_memory_dialog answers, read from the fixture's files at each call (like the CLI: a file created or a memory
// deleted meanwhile shows up).
function memoryDialog(fixture: MemoryFixture): unknown {
  const file = (kind: string, path: string, label: string, description: string) => ({ kind, path, label, description, exists: existsSync(path) })
  const field = (text: string, name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1]
  return {
    files: [
      file('user', fixture.user, 'User memory', 'Saved in the Claude config folder'),
      file('project', fixture.project, 'Project memory', 'Checked in at ./CLAUDE.md'),
      file('local', fixture.local, 'Local memory', 'Only for you, in ./CLAUDE.local.md'),
      file('other', fixture.imported, 'L imported.md', 'Imported by CLAUDE.md')
    ],
    folders: [{ kind: 'auto', path: `${fixture.dir}/`, label: 'Open auto-memory folder', description: '' }],
    memories: readdirSync(fixture.dir)
      .filter((name) => name.endsWith('.md') && name !== 'imported.md')
      .map((name) => {
        const path = join(fixture.dir, name)
        const text = readFileSync(path, 'utf8')
        return { name, path, description: field(text, 'description') ?? (name === 'MEMORY.md' ? 'Index of saved memories' : ''), type: field(text, 'type') ?? null, modified_ms: statSync(path).mtimeMs }
      })
  }
}

// Starts core + server; the session root holds a `project` folder. Claude Code's config folder (user settings file,
// prompt history) is a temp folder, never the real ~/.claude, and so are the files of the memory dialog (see
// MemoryFixture).
export async function startBackend(): Promise<Backend> {
  const root = mkdtempSync(join(tmpdir(), 'cw-pwa-root-'))
  mkdirSync(join(root, 'project'))
  const stateDir = mkdtempSync(join(tmpdir(), 'cw-pwa-state-'))
  const claudeDir = mkdtempSync(join(tmpdir(), 'cw-pwa-claude-'))
  const devices = await DeviceStore.load(stateDir)
  const memory = writeMemoryFixture(claudeDir)
  const scripted = createScriptedSdk({ wordDelayMs: 20 })
  scripted.settings.userDir = claudeDir
  const scriptedQuery = scripted.query
  // Every fake process answers the memory dialog from the fixture's files.
  const query = ((params: Parameters<typeof scriptedQuery>[0]) => {
    const handle = scriptedQuery(params)
    Object.defineProperty(scripted.last(), 'memoryDialog', { get: () => memoryDialog(memory) })
    return handle
  }) as typeof scriptedQuery
  let server: RunningServer | undefined
  const core = createCore({
    backendId: 'server',
    backendKind: 'remote',
    sdk: { ...scripted, query },
    stateDir,
    claudeConfigDir: claudeDir,
    allowedRoots: [root],
    hostCommands: deviceCommands(devices, (ids) => server?.disconnect(ids), 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
  })
  const hosts: string[] = []
  const origins: string[] = []
  const files = await loadStaticFiles(DIST)
  server = await startServer({ attach: core.attach, devices, port: 0, allowedHosts: hosts, allowedOrigins: origins, files, palettes: () => core.palettes(), log: () => undefined })
  const url = `http://127.0.0.1:${server.port}`
  hosts.push(`127.0.0.1:${server.port}`)
  origins.push(url)
  return { url, root, stateDir, claudeDir, memory, core, server, devices, files, stop: async () => (await core.closeAll(), await server!.close()) }
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

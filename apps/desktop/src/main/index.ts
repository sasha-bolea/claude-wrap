import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, Notification, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Notice } from '@claude-wrap/core'
import { CoreProcess } from './coreProcess.ts'

const APP_ID = 'dev.claude-wrap'
const APP_ORIGIN = 'app://claude-wrap'
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}
// Notification texts, by UI language (the renderer's dictionaries live in the page).
const NOTICE_TEXT = {
  en: { request: 'Claude needs you: {detail}', turnFinished: 'Claude has finished', error: 'The Claude process stopped' },
  it: { request: 'Claude ha bisogno di te: {detail}', turnFinished: 'Claude ha finito', error: 'Il processo di Claude si è fermato' }
}
// Dev server URL set by electron-vite in `npm run dev:desktop`; absent in built runs.
const DEV_URL = process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | undefined
const core = new CoreProcess({ notify: showNotice, failed: () => mainWindow?.webContents.send('core-failed') })

// State folder: e2e and dev runs that are not the real app use their own; the app uses %APPDATA%/claude-wrap
// (the same in development and packaged).
app.setPath('userData', process.env.CLAUDE_WRAP_STATE_DIR ?? join(app.getPath('appData'), 'claude-wrap'))

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

// Origin of a URL as "scheme://host". Node's URL.origin is "null" for non-special schemes like app:.
function originOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

// True if an IPC message comes from our own page (app:// or the dev server).
function fromOurPage(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const origin = event.senderFrame ? originOf(event.senderFrame.url) : ''
  return origin === APP_ORIGIN || (DEV_URL !== undefined && origin === originOf(DEV_URL))
}

// Reads every built renderer file into memory, keyed by URL path ("/index.html", "/assets/x.js").
// dir: the renderer build output. Returns the path → bytes map.
function loadRendererFiles(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  for (const relative of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const full = join(dir, relative)
    if (statSync(full).isFile()) files.set('/' + relative.replaceAll('\\', '/'), readFileSync(full))
  }
  return files
}

// Serves app://claude-wrap/* from the in-memory map only: exact path match, no filesystem path built from the URL.
function serveAppProtocol(): void {
  const files = loadRendererFiles(join(import.meta.dirname, '../renderer'))
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const body = url.host === 'claude-wrap' ? files.get(path) : undefined
    if (!body) return new Response('Not found', { status: 404 })
    const headers = { 'content-type': MIME_TYPES[extname(path)] ?? 'application/octet-stream', 'content-security-policy': CSP }
    return new Response(new Uint8Array(body), { headers })
  })
}

// Brokers a new connection: one end of a MessageChannel goes to the core, the other to the asking renderer.
// Only the local backend exists for now.
function brokerConnection(event: IpcMainEvent, backendId: unknown, requestId: unknown): void {
  if (!fromOurPage(event) || backendId !== 'local' || typeof requestId !== 'string') return
  const { port1, port2 } = new MessageChannelMain()
  core.attach(port1)
  event.sender.postMessage('port', { requestId }, [port2])
}

// Native folder picker for the start screen. Returns the chosen path or undefined.
async function chooseFolder(event: IpcMainInvokeEvent): Promise<string | undefined> {
  if (!fromOurPage(event) || !mainWindow) return undefined
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? undefined : result.filePaths[0]
}

// Opens a link from the conversation in the system browser, https only.
function openExternal(event: IpcMainEvent, url: unknown): void {
  if (!fromOurPage(event) || typeof url !== 'string') return
  if (URL.canParse(url) && new URL(url).protocol === 'https:') void shell.openExternal(url)
}

// System notification for a notice of the core, only while the window is not focused. Clicking it brings the
// window back on that tab.
function showNotice(notice: Notice): void {
  if (!Notification.isSupported() || mainWindow?.isFocused()) return
  const text = NOTICE_TEXT[app.getLocale().toLowerCase().startsWith('it') ? 'it' : 'en'][notice.kind]
  const notification = new Notification({ title: notice.title, body: text.replace('{detail}', notice.detail ?? '') })
  notification.on('click', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('activate-tab', notice.tabId)
  })
  notification.show()
}

// Creates the main window with the renderer locked down (no Node, no navigation, no new windows).
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void mainWindow.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`)
}

// Quit: the core closes every session (no orphan claude processes), then the app exits.
function quitGracefully(): void {
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void core.quit().finally(() => app.exit())
  })
}

// Startup: single instance, permissions, protocol, core, IPC, window.
function startApp(): void {
  if (!app.requestSingleInstanceLock()) return app.quit()
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  // Windows needs an AppUserModelID for notifications.
  app.setAppUserModelId(APP_ID)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'notifications'))
  if (!DEV_URL) serveAppProtocol()
  core.start()
  ipcMain.on('connect', brokerConnection)
  ipcMain.handle('choose-folder', chooseFolder)
  ipcMain.on('open-external', openExternal)
  quitGracefully()
  createWindow()
}

app.whenReady().then(startApp)
app.on('window-all-closed', () => app.quit())

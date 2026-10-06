// Shared-browser smoke (`npm run smoke:browser`): zero Claude tokens. Real Chromium + the real Playwright MCP, through
// createCore + a client Connection (subscribeBrowser): frames, navigation, mouse and touch input, text, wheel, tabs,
// denied downloads, Claude's side (the MCP acting on the same browser), idle close and restart, no process left.
// Uses port 3099 (3013 is the live server's) and a temp profile. Runs directly on Node 24.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createChannelPair, type BrowserEvent, type BrowserSnapshot } from '@athome/protocol'
import { Connection } from '@athome/client'
import { createCore } from '../src/index.ts'
import { browserWsUrl, CdpClient, connectCdp } from '../src/cdp.ts'
import { playwrightMcp } from '../../server/src/config.ts'

const PORT = 3099
const CHROME = process.env.CLAUDE_WRAP_CHROME ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1247', 'chrome-linux64', 'chrome')
const root = mkdtempSync(join(tmpdir(), 'athome-smoke-browser-'))
const profileDir = join(root, 'profile')
const failures: string[] = []

type Tab = BrowserSnapshot['tabs'][number]
type Frame = Extract<BrowserEvent, { type: 'browser.frame' }>

// Prints one check result; failures are collected for the exit code.
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Polls predicate every 50 ms; returns whether it became true within timeoutMs.
async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await sleep(50)
  }
  return false
}

// The page the tests drive: a button (box at 100,100 200x80) that sets the title, an input (100,250 200x40), a tall body.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>start</title>
<style>body{margin:0;height:4000px}#b{position:absolute;left:100px;top:100px;width:200px;height:80px}#i{position:absolute;left:100px;top:250px;width:200px;height:40px}</style></head>
<body><button id="b" onclick="document.title='clicked'">go</button><input id="i"></body></html>`

// Serves the page, a download answer and a second page on 127.0.0.1 (random port). Returns the server and its origin.
async function serve(): Promise<{ close: () => void; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/download')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="smoke-dl.bin"' })
      res.end('downloaded')
    } else if (req.url?.startsWith('/second')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>second</title><p>second page</p>')
    } else {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { close: () => server.close(), origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

// Process ids of Chromium instances using the temp profile.
function chromiumPids(): string[] {
  try {
    return execFileSync('pgrep', ['-f', '--', `--user-data-dir=${profileDir}`], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// Width and height of a JPEG from its first SOF marker; undefined when none is found.
function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined
    const marker = buf[i + 1] ?? 0
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return undefined
}

async function main(): Promise<void> {
  const site = await serve()
  const mcp = playwrightMcp(PORT)
  if (!mcp) throw new Error('@playwright/mcp is not installed')
  if (!existsSync(CHROME)) throw new Error(`no Chromium at ${CHROME}`)
  const core = createCore({ backendId: 'smoke-browser', backendKind: 'remote', coalesceMs: 2, browser: { port: PORT, executable: CHROME, profileDir, idleMs: 2000, mcp } })
  const connection = new Connection({
    openChannel: async () => {
      const [clientEnd, coreEnd] = createChannelPair()
      core.attach(coreEnd)
      return clientEnd
    },
    clientId: 'smoke-browser'
  })

  connection.start()

  // What the live view has seen.
  let tabs: Tab[] = []
  let running = false
  let frame: Frame | undefined
  let frames = 0
  const sink = {
    failed: (e: unknown) => console.log('  subscribe failed:', String(e)),
    snapshot: (s: BrowserSnapshot) => ((tabs = s.tabs), (running = s.running), s.frame && ((frame = s.frame), frames++)),
    event: (e: BrowserEvent) => {
      if (e.type === 'browser.tabs') ((tabs = e.tabs), (running = e.running))
      else if (e.type === 'browser.frame') ((frame = e), frames++)
    }
  }
  const framesAfter = async (action: () => Promise<unknown>): Promise<boolean> => {
    const before = frames
    await action()
    return until(() => frames > before)
  }
  const active = (): Tab | undefined => tabs.find((t) => t.active)
  const cmd = (name: 'browser.pointer', args: { type: 'down' | 'up'; x: number; y: number; touch?: boolean }) => connection.request(name, args)
  // A click/tap at page px (cssX, cssY) given the viewport size currently shown.
  const click = async (cssX: number, cssY: number, w: number, h: number, touch = false) => {
    await cmd('browser.pointer', { type: 'down', x: cssX / w, y: cssY / h, touch })
    await cmd('browser.pointer', { type: 'up', x: cssX / w, y: cssY / h, touch })
  }

  let page: CdpClient | undefined
  let pageSession = ''
  // Own CDP connection to the same port, attached to the active tab: evaluates an expression in it.
  const evaluate = async (expression: string): Promise<unknown> => {
    if (!page) page = new CdpClient(await connectCdp(await browserWsUrl(PORT)))
    const { sessionId } = await page.send<{ sessionId: string }>('Target.attachToTarget', { targetId: active()!.tabId, flatten: true })
    pageSession = sessionId
    const r = await page.send<{ result: { value: unknown } }>('Runtime.evaluate', { expression, returnByValue: true }, pageSession)
    await page.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
    return r.result.value
  }

  let mcpClient: Client | undefined
  try {
    // 1. subscribe starts Chromium once
    check('0 no Chromium before subscribe', chromiumPids().length === 0)
    const stop = connection.subscribeBrowser(sink)
    check('1 snapshot running with one tab', await until(() => running && tabs.length === 1), `running=${running} tabs=${tabs.length}`)
    check('1 a frame arrives', await until(() => frame !== undefined))
    const jpeg = Buffer.from(frame!.data, 'base64')
    const size = jpegSize(jpeg)
    check('1 frame is a JPEG', jpeg[0] === 0xff && jpeg[1] === 0xd8, `frame ${frame!.width}x${frame!.height} viewport ${frame!.viewportWidth}x${frame!.viewportHeight} jpeg ${size?.width}x${size?.height} bytes=${jpeg.length}`)
    const pids = chromiumPids()
    check('1 one Chromium browser process tree', pids.length >= 1, `pgrep matches=${pids.length}`)

    // 2. navigate
    await connection.request('browser.viewport', { width: 800, height: 600, mobile: false })
    await connection.request('browser.navigate', { url: `${site.origin}/?a` })
    check('2 tabs show the page url and title', await until(() => active()?.url.startsWith(site.origin) === true && active()?.title === 'start'), JSON.stringify(active()))

    // 3. mouse click
    await until(() => frames > 0 && frame?.viewportWidth === 800)
    await click(200, 140, frame!.width, frame!.height)
    check('3 mouse click changes the title', await until(() => active()?.title === 'clicked'), `title=${active()?.title} frame=${frame!.width}x${frame!.height}`)

    // 4. mobile viewport + touch
    check('4 frames continue after mobile viewport', await framesAfter(() => connection.request('browser.viewport', { width: 390, height: 844, mobile: true, scale: 2 })))
    await connection.request('browser.navigate', { url: `${site.origin}/?b` })
    check('4 page reloaded (title start)', await until(() => active()?.url.endsWith('?b') === true && active()?.title === 'start'), JSON.stringify(active()))
    await sleep(300)
    await until(() => frame?.viewportWidth === 390)
    await click(200, 140, frame!.width, frame!.height, true)
    check('4 touch tap changes the title', await until(() => active()?.title === 'clicked'), `title=${active()?.title} frame=${frame!.width}x${frame!.height} viewport ${frame!.viewportWidth}x${frame!.viewportHeight}`)
    const mobileJpeg = jpegSize(Buffer.from(frame!.data, 'base64'))
    console.log(`  mobile frame jpeg ${mobileJpeg?.width}x${mobileJpeg?.height}`)

    // 5. text
    await click(200, 270, frame!.width, frame!.height, true)
    await connection.request('browser.text', { text: 'ciao' })
    const value = await until(async () => (await evaluate('document.getElementById("i").value')) === 'ciao')
    check('5 typed text reaches the input', value, `value=${JSON.stringify(await evaluate('document.getElementById("i").value'))}`)

    // 6. wheel
    await connection.request('browser.wheel', { x: 0.5, y: 0.5, dx: 0, dy: 400 })
    check('6 wheel scrolls', await until(async () => ((await evaluate('window.scrollY')) as number) > 0), `scrollY=${await evaluate('window.scrollY')}`)

    // 7. tabs
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await connection.request('browser.tabNew', { url: `${site.origin}/second?t${i}` })).tabId)
    check('7 five tabs', await until(() => tabs.length === 5), `tabs=${tabs.length}`)
    const sixth = await connection.request('browser.tabNew', {}).then(() => 'accepted', (e: unknown) => String(e))
    check('7 the sixth is refused', sixth !== 'accepted' && tabs.length === 5, `${sixth} tabs=${tabs.length}`)
    const first = tabs.find((t) => !ids.includes(t.tabId))!
    await connection.request('browser.tabSelect', { tabId: first.tabId })
    check('7 tabSelect switches the active tab', await until(() => active()?.tabId === first.tabId))
    check('7 frames show the selected tab', await until(() => frame?.tabId === first.tabId), `frame tab=${frame?.tabId} selected=${first.tabId}`)
    for (const t of [...tabs]) await connection.request('browser.tabClose', { tabId: t.tabId })
    check('7 closing every tab leaves one blank tab', await until(() => tabs.length === 1 && tabs[0]?.url === 'about:blank'), JSON.stringify(tabs))

    // 8. downloads denied
    await connection.request('browser.navigate', { url: `${site.origin}/download` })
    await sleep(2000)
    const dirs = [profileDir, join(homedir(), 'Downloads'), join(profileDir, 'Default')]
    const found = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('smoke-dl')) : [])
    check('8 no download file appears', dirs.every((d) => found(d).length === 0), `looked in ${dirs.join(', ')}; found=${JSON.stringify(dirs.flatMap(found))} tab=${JSON.stringify(active())}`)
    try {
      const hits = execFileSync('find', [profileDir, '-name', '*smoke-dl*'], { encoding: 'utf8' }).trim()
      console.log(`  find in profile: ${hits || '(nothing)'}`)
    } catch {
      /* best effort */
    }

    // 9. Claude's side: the real Playwright MCP
    const transport = new StdioClientTransport({ command: mcp.command, args: mcp.args, stderr: 'pipe', cwd: root })
    mcpClient = new Client({ name: 'smoke-browser', version: '1' })
    await mcpClient.connect(transport)
    const toolNames = (await mcpClient.listTools()).tools.map((t) => t.name)
    check('9 MCP lists browser_navigate and browser_snapshot', toolNames.includes('browser_navigate') && toolNames.includes('browser_snapshot'), `${toolNames.length} tools`)
    const text = (r: unknown): string => JSON.stringify((r as { content?: unknown }).content ?? r).slice(0, 400)
    const nav = await mcpClient.callTool({ name: 'browser_navigate', arguments: { url: `${site.origin}/second?mcp` } })
    console.log(`  navigate: ${text(nav)}`)
    check('9 core sees the URL the MCP navigated to', await until(() => tabs.some((t) => t.url.includes('/second?mcp'))), JSON.stringify(tabs))
    const mcpTab = tabs.find((t) => t.url.includes('/second?mcp'))
    console.log(`  active tab: ${active()?.tabId} url=${active()?.url}; MCP tab: ${mcpTab?.tabId} active=${mcpTab?.active}; tabs=${tabs.length}`)
    const snap = await mcpClient.callTool({ name: 'browser_snapshot', arguments: {} })
    check('9 browser_snapshot sees the page', text(snap).includes('second page'), text(snap))
    if (mcpTab && !mcpTab.active) await connection.request('browser.tabSelect', { tabId: mcpTab.tabId })
    check('9 live view gets frames of the MCP-navigated page', await until(() => frame?.tabId === mcpTab?.tabId), `frame tab=${frame?.tabId}`)
    check('9 frames keep coming', await framesAfter(() => mcpClient!.callTool({ name: 'browser_navigate', arguments: { url: `${site.origin}/second?mcp2` } })))

    // 10. idle close and restart
    page?.close()
    page = undefined
    stop()
    const before = chromiumPids()
    check('10 Chromium gone after idle', await until(() => chromiumPids().length === 0, 12_000), `before=${before.length} after=${chromiumPids().length}`)
    // What reconnectMcpServer does in a session: the old MCP process ends and a new one starts with the same command,
    // while Chromium is still down. It connects to Chromium lazily, on its first tool call.
    const staleClient = mcpClient
    mcpClient = new Client({ name: 'smoke-browser', version: '1' })
    await mcpClient.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args, stderr: 'pipe', cwd: root }))
    check('10 reconnected MCP lists tools with Chromium down', (await mcpClient.listTools()).tools.length > 0 && chromiumPids().length === 0)
    // The PreToolUse hook starts Chromium first (here: a client subscribes, which is what ensure() does).
    connection.subscribeBrowser(sink)
    check('10 ensure starts Chromium again', await until(() => running && tabs.length >= 1 && chromiumPids().length > 0), `tabs=${tabs.length} pids=${chromiumPids().length}`)
    // Info only: the MCP that was NOT reconnected stays broken (the bug the reconnect fixes).
    const stale = await staleClient.callTool({ name: 'browser_snapshot', arguments: {} }).then((r) => `OK ${text(r)}`, (e: unknown) => `ERROR ${String(e)}`)
    console.log(`  info: stale MCP browser_snapshot after restart: ${stale}`)
    await staleClient.close().catch(() => undefined)
    const nav2 = await mcpClient.callTool({ name: 'browser_navigate', arguments: { url: `${site.origin}/second?after` } }).then((r) => `OK ${text(r)}`, (e: unknown) => `ERROR ${String(e)}`)
    console.log(`  reconnected MCP browser_navigate: ${nav2}`)
    check('10 reconnected MCP navigates and core sees it', nav2.startsWith('OK') && (await until(() => tabs.some((t) => t.url.includes('/second?after')), 5000)), nav2.slice(0, 200))
    const snap2 = await mcpClient.callTool({ name: 'browser_snapshot', arguments: {} }).then((r) => text(r), (e: unknown) => `ERROR ${String(e)}`)
    check('10 reconnected MCP browser_snapshot sees the page', snap2.includes('second page'), snap2.slice(0, 200))
  } finally {
    await mcpClient?.close().catch(() => undefined)
    page?.close()
    connection.close?.()
    await core.closeAll()
    site.close()
    // 11. nothing left
    check('11 no Chromium left after core close', await until(() => chromiumPids().length === 0, 8000), `pids=${chromiumPids().join(',')}`)
    rmSync(root, { recursive: true, force: true })
  }
}

main().then(
  () => (console.log(failures.length ? `\nFAILED: ${failures.join('; ')}` : '\nALL PASSED'), process.exit(failures.length ? 1 : 0)),
  (error) => (console.error(error), process.exit(1))
)

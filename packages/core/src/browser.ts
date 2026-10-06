import { spawn } from 'node:child_process'
import { LIMITS, browserStream, type BrowserEvent, type BrowserSnapshot, type CommandArgs, type StreamPosition } from '@athome/protocol'
import { browserWsUrl, CdpClient, connectCdp, type CdpTransport } from './cdp.ts'
import { CoreError, messageOf } from './errors.ts'
import { Stream, type RingLimits, type Send } from './stream.ts'

// The server's one Chromium, shared by Sasha (a live view: screencast frames in, pointer/keys out) and, later, by
// Claude (Playwright MCP over CDP on the same port). It starts on demand, lives while someone uses it and is closed
// after IDLE_MS of no use. Its stream ('browser') carries the tabs, the latest frame and who is acting in it.

// What the host is given to run Chromium (see CoreConfig.browser).
export type BrowserSettings = {
  port: number
  executable: string
  profileDir: string
  launch?: (args: string[]) => BrowserProcess
  connect?: (port: number) => Promise<CdpTransport>
  idleMs?: number
}
export type BrowserProcess = { kill(): void; exited: Promise<void> }

const IDLE_MS = 15 * 60_000
// Frames are sent at most this often: the newest one wins, older ones are dropped (every frame is acknowledged).
const FRAME_MS = 33
// Only the newest frames are kept for replay; a frame is large, so a client that missed one gets a reset instead.
const RING: RingLimits = { events: 8, bytes: 1024 * 1024 }
const DEFAULT_SIZE = { width: 1280, height: 800 }
const JPEG_QUALITY = 60
const KILL_GRACE_MS = 3000

type Tab = BrowserSnapshot['tabs'][number]
type Frame = Extract<BrowserEvent, { type: 'browser.frame' }>
type Viewport = CommandArgs<'browser.viewport'>
type Pointer = CommandArgs<'browser.pointer'>
type Session = { targetId: string; sessionId: string; casting: boolean }
type TargetInfo = { targetId: string; type?: string; url?: string; title?: string }

// Chromium's launch flags: headless, DevTools only on loopback, a private profile, the sandbox kept.
export function launchArgs(port: number, profileDir: string): string[] {
  return [
    '--headless=new', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--password-store=basic', '--disable-features=Translate,MediaRouter',
    '--window-size=1280,800', 'about:blank'
  ]
}

// Runs the executable as a child process. Returns its handle: kill() asks politely, then forces after a grace period.
function spawnBrowser(executable: string, args: string[]): BrowserProcess {
  const child = spawn(executable, args, { stdio: 'ignore' })
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref()
  }
  return { kill, exited }
}

// Waits for Chromium's DevTools endpoint and opens the browser-level connection.
async function connectToPort(port: number): Promise<CdpTransport> {
  return connectCdp(await browserWsUrl(port))
}

export class BrowserHost {
  private readonly settings: BrowserSettings
  private readonly stream: Stream
  private readonly subscribers = new Set<Send>()
  private readonly targets = new Map<string, Tab>()
  private cdp?: CdpClient
  private proc?: BrowserProcess
  private starting?: Promise<void>
  private running = false
  private activeId?: string
  private session?: Session
  private chain: Promise<void> = Promise.resolve()
  private viewport?: Viewport
  private deviceSize?: { width: number; height: number }
  private lastFrame?: Frame
  private pendingFrame?: Frame
  private frameTimer?: NodeJS.Timeout
  private frameSeq = 0
  private pressed?: string
  private acting: BrowserSnapshot['acting'] = []
  private idleTimer?: NodeJS.Timeout

  // settings: how to run Chromium (launch/connect are replaced in tests).
  constructor(settings: BrowserSettings) {
    this.settings = settings
    this.stream = new Stream(browserStream(), () => this.snapshot(), RING)
  }

  // ---- public ----

  // Makes sure Chromium runs (starting it if needed; concurrent calls share one start) and counts as use.
  // Returns when the DevTools connection is ready. Throws CoreError internal if it cannot start.
  async ensure(): Promise<void> {
    this.markUse()
    if (this.cdp && !this.cdp.closed && this.running) return
    this.starting ??= this.start().finally(() => (this.starting = undefined))
    await this.starting
  }

  // A client watches: Chromium starts, the client gets the snapshot (a replay when position is still in the ring),
  // and the screencast runs while anyone watches.
  async subscribe(send: Send, position?: StreamPosition): Promise<void> {
    await this.ensure()
    this.subscribers.add(send)
    this.stream.attach(send, position)
    await this.sync()
  }

  // A client stopped watching; the screencast stops with the last one. Never starts Chromium.
  async unsubscribe(send: Send): Promise<void> {
    this.stream.detach(send)
    if (!this.subscribers.delete(send)) return
    this.markUse()
    if (this.running) await this.sync()
  }

  // The chats whose Claude is using the browser now (step 4 calls this); sessions: tab id and title of each.
  setActing(sessions: BrowserSnapshot['acting']): void {
    this.acting = sessions
    this.stream.emit({ type: 'browser.acting', sessions })
  }

  // Core is shutting down: Chromium ends.
  close(): void {
    this.shutdown(false)
  }

  // ---- commands (each one counts as use and starts Chromium when needed) ----

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url })
  }

  async reload(): Promise<void> {
    await this.send('Page.reload', {})
  }

  // Moves one step in the history. delta: -1 back, +1 forward; nothing there → nothing happens.
  async history(delta: -1 | 1): Promise<void> {
    const history = await this.send<{ currentIndex?: number; entries?: Array<{ id: number }> }>('Page.getNavigationHistory', {})
    const entry = history.entries?.[(history.currentIndex ?? 0) + delta]
    if (entry) await this.send('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  // Opens a tab (url or about:blank) and shows it. Returns its id; refused beyond LIMITS.browserMaxTabs.
  async tabNew(url?: string): Promise<string> {
    await this.ensure()
    if (this.targets.size >= LIMITS.browserMaxTabs) throw new CoreError('invalid_args', `at most ${LIMITS.browserMaxTabs} tabs`)
    const { targetId } = await this.cdp!.send<{ targetId: string }>('Target.createTarget', { url: url ?? 'about:blank' })
    if (!this.targets.has(targetId)) this.targets.set(targetId, { tabId: targetId, url: url ?? 'about:blank', title: '', active: false })
    await this.activate(targetId)
    return targetId
  }

  // Shows another tab (the screencast and the input follow).
  async tabSelect(tabId: string): Promise<void> {
    await this.ensure()
    this.tabOf(tabId)
    await this.activate(tabId)
  }

  // Closes a tab; the last one is replaced by a blank page so Chromium always has one.
  async tabClose(tabId: string): Promise<void> {
    await this.ensure()
    this.tabOf(tabId)
    await this.cdp!.send('Target.closeTarget', { targetId: tabId })
    this.removeTarget(tabId)
    if (this.targets.size === 0) await this.tabNew()
    else await this.sync()
  }

  // A pointer event at a place given as fractions (0..1) of the page shown.
  async pointer(args: Pointer): Promise<void> {
    const { x, y } = this.toPage(args.x, args.y)
    if (args.touch) return this.touchPointer(args.type, x, y)
    const button = args.button ?? 'left'
    const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[args.type]
    if (args.type === 'down') this.pressed = button
    const held = args.type === 'move' ? (this.pressed ?? 'none') : button
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: held, ...(args.type === 'move' ? {} : { clickCount: args.clickCount ?? 1 }) })
    if (args.type === 'up') this.pressed = undefined
  }

  async wheel(args: CommandArgs<'browser.wheel'>): Promise<void> {
    const { x, y } = this.toPage(args.x, args.y)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: args.dx, deltaY: args.dy })
  }

  async text(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }

  // Sets the size of the page on the active tab (last caller wins); the screencast restarts at the new size.
  async setViewport(viewport: Viewport): Promise<void> {
    await this.ensure()
    this.viewport = viewport
    await this.exclusive(async () => {
      if (this.session) await this.applyViewport(this.session.sessionId)
      if (this.session?.casting) await this.restartCast(this.session)
    })
  }

  // ---- start and stop ----

  // Launches Chromium, connects, and prepares it; on failure nothing is left running.
  private async start(): Promise<void> {
    const { port, executable, profileDir, launch, connect } = this.settings
    const proc = (launch ?? ((args) => spawnBrowser(executable, args)))(launchArgs(port, profileDir))
    this.proc = proc
    try {
      const client = new CdpClient(await (connect ?? connectToPort)(port))
      this.cdp = client
      await this.prepare(client)
      void client.closedPromise.then(() => this.lost(client))
      void proc.exited.then(() => this.lost(client))
    } catch (error) {
      this.cdp?.close()
      this.cdp = undefined
      this.proc = undefined
      proc.kill()
      throw new CoreError('internal', `the browser did not start: ${messageOf(error)}`)
    }
    this.running = true
    this.emitTabs()
    this.markUse()
  }

  // Listens for targets and frames, denies downloads, and learns the tabs already open.
  private async prepare(client: CdpClient): Promise<void> {
    client.on('Target.targetCreated', (params) => this.onTargetInfo(params))
    client.on('Target.targetInfoChanged', (params) => this.onTargetInfo(params))
    client.on('Target.targetDestroyed', (params) => this.removeTarget(String((params as { targetId?: unknown }).targetId)))
    client.on('Page.screencastFrame', (params, sessionId) => this.onFrame(client, params, sessionId))
    await client.send('Target.setDiscoverTargets', { discover: true })
    await client.send('Browser.setDownloadBehavior', { behavior: 'deny' })
    const { targetInfos } = await client.send<{ targetInfos?: TargetInfo[] }>('Target.getTargets', {})
    for (const info of targetInfos ?? []) this.addTarget(info)
  }

  // Chromium went away on its own (or the connection broke): report it; the next use starts it again.
  private lost(client: CdpClient): void {
    if (this.cdp === client) this.shutdown(true)
  }

  // Ends Chromium and forgets everything about it. notify: tell the clients (not at core shutdown).
  private shutdown(notify: boolean): void {
    clearTimeout(this.idleTimer)
    clearTimeout(this.frameTimer)
    this.frameTimer = this.pendingFrame = this.lastFrame = undefined
    const client = this.cdp
    const proc = this.proc
    this.cdp = this.proc = this.session = this.activeId = undefined
    this.pressed = undefined
    this.targets.clear()
    const wasRunning = this.running
    this.running = false
    client?.close()
    proc?.kill()
    if (notify && wasRunning) this.emitTabs()
  }

  // Counts as use: the idle clock restarts, and runs only while nobody watches.
  private markUse(): void {
    clearTimeout(this.idleTimer)
    if (!this.running || this.subscribers.size > 0) return
    this.idleTimer = setTimeout(() => this.shutdown(true), this.settings.idleMs ?? IDLE_MS)
    this.idleTimer.unref()
  }

  // ---- tabs ----

  private tabOf(tabId: string): Tab {
    const tab = this.targets.get(tabId)
    if (!tab) throw new CoreError('not_found', `browser tab ${tabId} not found`)
    return tab
  }

  // The tab shown: the last one selected, else the first.
  private activeTarget(): string | undefined {
    return this.activeId && this.targets.has(this.activeId) ? this.activeId : this.targets.keys().next().value
  }

  // Makes a tab the shown one and brings it to the front.
  private async activate(targetId: string): Promise<void> {
    this.activeId = targetId
    this.emitTabs()
    await this.cdp?.send('Target.activateTarget', { targetId }).catch(() => undefined)
    await this.sync()
  }

  // A page target appeared or changed (other kinds of target are ignored).
  private onTargetInfo(params: unknown): void {
    const info = (params as { targetInfo?: TargetInfo }).targetInfo
    if (info) this.addTarget(info)
  }

  private addTarget(info: TargetInfo): void {
    if (info.type !== 'page') return
    const previous = this.targets.get(info.targetId)
    const tab = { tabId: info.targetId, url: info.url ?? '', title: info.title ?? '', active: false }
    if (previous && previous.url === tab.url && previous.title === tab.title) return
    this.targets.set(info.targetId, tab)
    this.emitTabs()
  }

  private removeTarget(targetId: string): void {
    if (!this.targets.delete(targetId)) return
    if (this.activeId === targetId) this.activeId = undefined
    this.emitTabs()
    if (this.running) void this.sync().catch(() => undefined)
  }

  private emitTabs(): void {
    this.stream.emit({ type: 'browser.tabs', ...this.tabsState() })
  }

  private tabsState(): { tabs: Tab[]; running: boolean } {
    const active = this.activeTarget()
    return { tabs: [...this.targets.values()].map((tab) => ({ ...tab, active: tab.tabId === active })), running: this.running }
  }

  // ---- session and screencast ----

  // Runs one step after the previous ones: session and screencast changes never overlap.
  private exclusive<T>(step: () => Promise<T>): Promise<T> {
    const result = this.chain.then(step)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }

  // Brings the CDP session and the screencast to what is wanted: attached to the shown tab, casting while watched.
  private sync(): Promise<void> {
    return this.exclusive(async () => {
      const wanted = this.cdp && this.running ? this.activeTarget() : undefined
      if (this.session && this.session.targetId !== wanted) await this.detach(this.session)
      if (wanted && !this.session) this.session = await this.attach(wanted)
      const session = this.session
      if (!session) return
      if (this.subscribers.size > 0 && !session.casting) await this.startCast(session)
      else if (this.subscribers.size === 0 && session.casting) await this.stopCast(session)
    })
  }

  // The session of the shown tab, attached if needed.
  private async activeSession(): Promise<string> {
    await this.sync()
    if (!this.session) throw new CoreError('not_found', 'the browser has no open tab')
    return this.session.sessionId
  }

  private async attach(targetId: string): Promise<Session> {
    const { sessionId } = await this.cdp!.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    await this.cdp!.send('Page.enable', {}, sessionId)
    await this.applyViewport(sessionId)
    return { targetId, sessionId, casting: false }
  }

  private async detach(session: Session): Promise<void> {
    if (session.casting) await this.stopCast(session)
    this.session = this.lastFrame = this.pendingFrame = undefined
    await this.cdp?.send('Target.detachFromTarget', { sessionId: session.sessionId }).catch(() => undefined)
  }

  private async startCast(session: Session): Promise<void> {
    const { width, height } = this.castSize()
    await this.cdp!.send('Page.startScreencast', { format: 'jpeg', quality: JPEG_QUALITY, maxWidth: width, maxHeight: height, everyNthFrame: 1 }, session.sessionId)
    session.casting = true
  }

  private async stopCast(session: Session): Promise<void> {
    session.casting = false
    await this.cdp?.send('Page.stopScreencast', {}, session.sessionId).catch(() => undefined)
  }

  private async restartCast(session: Session): Promise<void> {
    await this.stopCast(session)
    await this.startCast(session)
  }

  // Largest frame wanted: the page size times its pixel ratio.
  private castSize(): { width: number; height: number } {
    const v = this.viewport
    return v ? { width: Math.round(v.width * (v.scale ?? 1)), height: Math.round(v.height * (v.scale ?? 1)) } : DEFAULT_SIZE
  }

  // Applies the wanted page size and touch emulation to a session.
  private async applyViewport(sessionId: string): Promise<void> {
    const v = this.viewport
    if (!v) return
    await this.cdp!.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.scale ?? 1, mobile: v.mobile }, sessionId)
    await this.cdp!.send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile }, sessionId)
  }

  // ---- frames ----

  // A screencast frame: acknowledged at once (Chromium waits for it), kept as the newest one, sent on the next tick.
  private onFrame(client: CdpClient, params: unknown, cdpSession?: string): void {
    const p = params as { data?: string; sessionId?: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }
    void client.send('Page.screencastFrameAck', { sessionId: p.sessionId }, cdpSession).catch(() => undefined)
    const session = this.session
    if (!session || session.sessionId !== cdpSession || typeof p.data !== 'string') return
    const width = Math.round(p.metadata?.deviceWidth ?? DEFAULT_SIZE.width)
    const height = Math.round(p.metadata?.deviceHeight ?? DEFAULT_SIZE.height)
    this.deviceSize = { width, height }
    const view = this.viewport ?? { width, height }
    this.pendingFrame = { type: 'browser.frame', tabId: session.targetId, data: p.data, width, height, viewportWidth: view.width, viewportHeight: view.height, seq: ++this.frameSeq }
    this.frameTimer ??= setTimeout(() => this.flushFrame(), FRAME_MS)
  }

  private flushFrame(): void {
    this.frameTimer = undefined
    const frame = this.pendingFrame
    this.pendingFrame = undefined
    if (!frame) return
    this.lastFrame = frame
    this.stream.emit(frame)
  }

  // ---- input ----

  // Page coordinates (CSS px) of a place given as fractions of the last frame (else of the page size asked for).
  private toPage(x: number, y: number): { x: number; y: number } {
    const size = this.deviceSize ?? this.viewport ?? DEFAULT_SIZE
    return { x: Math.round(x * size.width), y: Math.round(y * size.height) }
  }

  // A touch at (x, y) in page px; start/move/end of a finger.
  private async touchPointer(type: Pointer['type'], x: number, y: number): Promise<void> {
    const name = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type]
    await this.send('Input.dispatchTouchEvent', { type: name, touchPoints: type === 'up' ? [] : [{ x, y }] })
  }

  // Calls a CDP method on the shown tab's session; counts as use and starts Chromium when needed.
  private async send<T = unknown>(method: string, params: unknown): Promise<T> {
    await this.ensure()
    const sessionId = await this.activeSession()
    return this.cdp!.send<T>(method, params, sessionId)
  }

  // ---- snapshot ----

  private snapshot(): BrowserSnapshot {
    return { kind: 'browser', ...this.tabsState(), acting: this.acting, ...(this.lastFrame ? { frame: this.lastFrame } : {}) }
  }
}

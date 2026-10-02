import {
  COMMANDS,
  PING_INTERVAL_MS,
  PING_MISSES,
  PROTOCOL_VERSION,
  WORKSPACE_STREAM,
  coreFrameSchema,
  tabStream,
  type Channel,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type CoreFrame,
  type ErrorCode,
  type StreamPosition,
  type TabEvent,
  type TabSnapshot,
  type WorkspaceEvent,
  type WorkspaceSnapshot
} from '@claude-wrap/protocol'
import { Store } from './store.ts'

export class ClientError extends Error {
  readonly code: ErrorCode | 'closed'

  constructor(code: ErrorCode | 'closed', message: string) {
    super(message)
    this.code = code
  }
}

export interface ConnectionOptions {
  // Opens a fresh channel to the backend (desktop: brokered MessagePort; PWA: WebSocket; tests: in-memory).
  openChannel: () => Promise<Channel>
  // Stable per install: core recognises retried commands by (clientId, cmd id).
  clientId: string
  token?: string
  visible?: () => boolean
  // Reconnect backoff (doubles up to maxMs).
  retry?: { initialMs: number; maxMs: number }
}

type PendingCommand = { frame: { t: 'cmd'; id: string; name: CommandName; args: unknown }; resolve: (result: unknown) => void; reject: (error: Error) => void }

const TAB_PREFIX = 'tab:'

// Transport-agnostic link to one backend: hello/welcome, idempotent commands re-sent after reconnects,
// numbered streams resumed by {epoch, seq}, app-level ping, reconnect with backoff. Feeds a Store.
export class Connection {
  readonly store = new Store()
  private readonly options: ConnectionOptions
  private channel?: Channel
  private greeted = false
  private readonly positions = new Map<string, StreamPosition>()
  private readonly wantedTabs = new Set<string>()
  private readonly pending = new Map<string, PendingCommand>()
  private pingTimer?: ReturnType<typeof setInterval>
  private missedPings = 0
  private pingCounter = 0
  private retryMs: number
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private started = false

  constructor(options: ConnectionOptions) {
    this.options = options
    this.retryMs = options.retry?.initialMs ?? 250
  }

  // Connects (once: later calls do nothing, so a host may start it and a view may too).
  start(): void {
    if (this.started) return
    this.started = true
    void this.connect()
  }

  // Sends a command (now, or after the next welcome) and resolves with its validated result.
  request<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>> {
    return new Promise((resolve, reject) => {
      const frame = { t: 'cmd' as const, id: crypto.randomUUID(), name, args }
      this.pending.set(frame.id, { frame, resolve: resolve as (result: unknown) => void, reject })
      if (this.greeted) this.channel?.send(frame)
    })
  }

  // Starts receiving a tab's transcript (also after reconnects).
  subscribeTab(tabId: string): Promise<CommandResult<'tab.subscribe'>> {
    this.wantedTabs.add(tabId)
    return this.request('tab.subscribe', { tabId })
  }

  unsubscribeTab(tabId: string): Promise<CommandResult<'tab.unsubscribe'>> {
    this.wantedTabs.delete(tabId)
    this.positions.delete(tabStream(tabId))
    this.store.dropTab(tabId)
    return this.request('tab.unsubscribe', { tabId })
  }

  // Reconnects at once when offline (page back on screen, network back) instead of waiting for the backoff.
  reconnectNow(): void {
    if (this.stopped || this.channel) return
    clearTimeout(this.reconnectTimer)
    this.retryMs = this.options.retry?.initialMs ?? 250
    void this.connect()
  }

  // Stops for good: no reconnect, pending commands rejected.
  close(): void {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    if (this.channel) this.drop(this.channel)
    for (const { reject } of this.pending.values()) reject(new ClientError('closed', 'connection closed'))
    this.pending.clear()
  }

  // Opens a channel and says hello with the positions of every stream to resume.
  private async connect(): Promise<void> {
    if (this.stopped) return
    this.store.setConnection('connecting', { welcome: this.store.getSnapshot().welcome })
    let channel: Channel
    try {
      channel = await this.options.openChannel()
    } catch {
      return this.scheduleReconnect()
    }
    if (this.stopped) return channel.close()
    this.channel = channel
    this.greeted = false
    channel.onMessage((raw) => this.onFrame(channel, raw))
    channel.onClose(() => this.drop(channel))
    const resume = Object.fromEntries(this.positions)
    const { clientId, token, visible } = this.options
    channel.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId, token, visible: visible?.() ?? true, resume })
  }

  private onFrame(channel: Channel, raw: unknown): void {
    if (channel !== this.channel) return
    const parsed = coreFrameSchema.safeParse(raw)
    if (!parsed.success) return this.drop(channel)
    this.missedPings = 0
    this.handle(channel, parsed.data)
  }

  private handle(channel: Channel, frame: CoreFrame): void {
    switch (frame.t) {
      case 'welcome':
        return this.onWelcome(channel, frame)
      case 'fatal':
        return this.onFatal(channel, frame.error)
      case 'reply':
        return this.onReply(frame)
      case 'reset':
        return this.onReset(frame.stream, frame.epoch, frame.seq, frame.snapshot)
      case 'ev':
        return this.onEvent(channel, frame.stream, frame.epoch, frame.seq, frame.ev)
      case 'gone':
        return this.onGone(frame.stream)
      case 'pong':
        return
    }
  }

  // Connected: reset backoff, start pinging, re-send every unanswered command with its original id.
  private onWelcome(channel: Channel, welcome: Extract<CoreFrame, { t: 'welcome' }>): void {
    this.greeted = true
    this.retryMs = this.options.retry?.initialMs ?? 250
    this.store.setConnection('connected', { welcome })
    this.startPing(channel)
    for (const { frame } of this.pending.values()) channel.send(frame)
  }

  // Refused by core: version mismatch and bad credentials stop the connection, anything else retries.
  private onFatal(channel: Channel, error: Extract<CoreFrame, { t: 'fatal' }>['error']): void {
    if (error.code === 'incompatible_protocol' || error.code === 'unauthorized') {
      this.stopped = true
      this.store.setConnection(error.code === 'unauthorized' ? 'unauthorized' : 'incompatible', { error })
    }
    this.drop(channel)
  }

  private onReply(frame: Extract<CoreFrame, { t: 'reply' }>): void {
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    if (!frame.ok) return pending.reject(new ClientError(frame.error.code, frame.error.message))
    const result = COMMANDS[pending.frame.name].result.safeParse(frame.result)
    if (result.success) pending.resolve(result.data)
    else pending.reject(new ClientError('invalid_args', `invalid result for ${pending.frame.name}`))
  }

  private onReset(stream: string, epoch: string, seq: number, snapshot: WorkspaceSnapshot | TabSnapshot): void {
    if (snapshot.kind === 'workspace') this.store.applyWorkspaceReset(snapshot)
    else if (this.wantedTabs.has(tabIdOf(stream))) this.store.applyTabReset(tabIdOf(stream), snapshot)
    else return
    this.positions.set(stream, { epoch, lastSeq: seq })
  }

  // Applies an event in sequence; a gap means something was lost → reconnect, and the core resets the stream.
  private onEvent(channel: Channel, stream: string, epoch: string, seq: number, ev: WorkspaceEvent | TabEvent): void {
    const position = this.positions.get(stream)
    if (!position) return
    if (position.epoch !== epoch || seq !== position.lastSeq + 1) return this.drop(channel)
    this.positions.set(stream, { epoch, lastSeq: seq })
    if (stream === WORKSPACE_STREAM) this.store.applyWorkspaceEvent(ev as WorkspaceEvent)
    else this.store.applyTabEvent(tabIdOf(stream), ev as TabEvent)
  }

  private onGone(stream: string): void {
    this.positions.delete(stream)
    if (!stream.startsWith(TAB_PREFIX)) return
    this.wantedTabs.delete(tabIdOf(stream))
    this.store.dropTab(tabIdOf(stream))
  }

  // Liveness: after PING_MISSES pings without any frame back, the channel is considered dead.
  private startPing(channel: Channel): void {
    clearInterval(this.pingTimer)
    this.missedPings = 0
    this.pingTimer = setInterval(() => {
      if (this.missedPings >= PING_MISSES) return this.drop(channel)
      this.missedPings++
      channel.send({ t: 'ping', n: ++this.pingCounter })
    }, PING_INTERVAL_MS)
  }

  // Forgets a channel (closed, dead or misbehaving) and schedules a reconnect. Idempotent.
  private drop(channel: Channel): void {
    if (channel !== this.channel) return
    this.channel = undefined
    this.greeted = false
    clearInterval(this.pingTimer)
    channel.close()
    const { status } = this.store.getSnapshot()
    if (status !== 'incompatible' && status !== 'unauthorized') this.store.setConnection('offline', { welcome: this.store.getSnapshot().welcome })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => void this.connect(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, this.options.retry?.maxMs ?? 5000)
  }
}

const tabIdOf = (stream: string) => stream.slice(TAB_PREFIX.length)

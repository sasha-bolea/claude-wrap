import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  EFFORT_LEVELS,
  tabStream,
  type Effort,
  type Image,
  type Item,
  type ModelInfo,
  type PermissionMode,
  type QueuePause,
  type SlashCommand,
  type StreamPosition,
  type TabMeta,
  type TabStatus
} from '@claude-wrap/protocol'
import type { Notice, SdkApi } from './config.ts'
import { CoreError, messageOf } from './errors.ts'
import { suggestFiles } from './fileSuggestions.ts'
import { Normalizer } from './normalize.ts'
import { runShell } from './process.ts'
import { Requests, modeSetBy, type Answer } from './requests.ts'
import { Session } from './session.ts'
import type { PersistedTab } from './state.ts'
import type { Send } from './stream.ts'
import { Transcript, type TranscriptOptions } from './transcript.ts'

// Options every session gets (architettura.md; same as the first attempt).
const BASE_OPTIONS: Options = {
  includePartialMessages: true,
  enableFileCheckpointing: true,
  settingSources: ['user', 'project', 'local'],
  systemPrompt: { type: 'preset', preset: 'claude_code' }
}

export interface TabEnvironment {
  sdk: SdkApi
  sdkOptions: Options
  transcript: TranscriptOptions
  closeTimeoutMs: number
  // Throws limit_reached when no more processes may start.
  checkCanStart(): void
  // Runs before every spawn: canonical cwd, allowed roots and trust gate. Returns the cwd to spawn in, or throws
  // needs_trust / outside_root / not_found.
  prepareStart(cwd: string): Promise<string>
  notify(tab: Tab, kind: Notice['kind'], detail?: string): void
  processStarted(pid: number, startedAt: number): void
  processExited(pid: number): void
  // The tab's metadata changed (→ workspace tab.updated).
  changed(tab: Tab): void
  turnFinished(tab: Tab): void
  // The CLI announced or moved the session id (→ session index).
  sessionIdChanged(tab: Tab, previous: string | undefined): void
  // A prompt was accepted (→ prompt history).
  promptSent(tab: Tab, text: string): void
  // A usage limit was hit: every queue waits until `until` (ms).
  rateLimited(until: number): void
}

// A user message on its way: queueId is the cmd id (SDK message uuid); pastes are long pasted texts inside text.
export type Outgoing = { queueId: string; text: string; from: string; images?: Image[]; pastes?: string[] }

export type TabInit = {
  tabId: string
  cwd: string
  resume?: string
  title?: string
  model?: string
  effort?: Effort
  mode?: PermissionMode
  cachedModels?: ModelInfo[]
  cachedCommands?: SlashCommand[]
  queue?: Outgoing[]
  queuePause?: QueuePause
  // The title follows the CLI's own title (default: when no title is given).
  autoTitle?: boolean
}

// Lifecycle of the tab's process; the visible status adds the turn state on top of `live`.
type Lifecycle = 'dormant' | 'starting' | 'live' | 'closing' | 'needs_trust' | 'error'

// What the CLI says of a sent message (capability msg_lifecycle_v1; the SDK's types do not have it).
type CommandLifecycle = { type: 'command_lifecycle'; command_uuid: string; state: 'queued' | 'started' | 'completed' | 'cancelled' }
const isCommandLifecycle = (message: unknown): message is CommandLifecycle => (message as { type?: string }).type === 'command_lifecycle'

// One tab: metadata, transcript, open requests, queue, and the lazily started CLI session.
// Viewing never starts a process: only sending (or asking models/commands with nothing cached) does.
export class Tab {
  readonly tabId: string
  // Canonicalized by prepareStart at every spawn.
  cwd: string
  readonly transcript: Transcript
  title: string
  // The title follows the CLI's own title of the session until the user gives the tab one.
  private autoTitle: boolean
  sessionId?: string
  model?: string
  activeModel?: string
  effort?: Effort
  mode: PermissionMode
  private confirmedMode: PermissionMode
  private lifecycle: Lifecycle = 'dormant'
  private turnRunning = false
  private error?: string
  private queue: Outgoing[]
  private queuePause?: QueuePause
  // Messages the CLI holds (command_lifecycle), from queued or started until completed or cancelled.
  private readonly held = new Map<string, 'queued' | 'started'>()
  // Transcript-only messages (the `!` shell output): their lifecycle frames are not turns.
  private readonly silentUuids = new Set<string>()
  private shellAbort?: AbortController
  // Empty results still due for transcript-only messages (the CLI answers each one with a result, num_turns 0).
  private silentResults = 0
  private normalizer: Normalizer
  private readonly requests: Requests
  private readonly env: TabEnvironment
  private session?: Session
  private startPromise?: Promise<Session>
  private historyPromise?: Promise<void>
  private closePromise?: Promise<void>
  private modeCallsInFlight = 0
  private modeChain: Promise<unknown> = Promise.resolve()
  private cachedModels?: ModelInfo[]
  private cachedCommands?: SlashCommand[]
  // lastModified of the stored session when its history was loaded, and whether a process ever ran here.
  private historyModified?: number
  private liveStarted = false

  constructor(init: TabInit, env: TabEnvironment) {
    this.env = env
    this.tabId = init.tabId
    this.cwd = init.cwd
    this.title = init.title || basename(init.cwd) || init.cwd
    this.autoTitle = init.autoTitle ?? !init.title
    this.sessionId = init.resume
    this.model = init.model
    this.effort = init.effort
    this.mode = this.confirmedMode = init.mode ?? 'default'
    this.cachedModels = init.cachedModels
    this.cachedCommands = init.cachedCommands
    this.queue = init.queue ?? []
    // A queue that comes back after a restart waits for ▶ (nothing starts by itself at boot).
    this.queuePause = init.queuePause ?? (this.queue.length ? { reason: 'stop' } : undefined)
    this.transcript = new Transcript(tabStream(init.tabId), () => this.requests.list(), env.transcript)
    this.normalizer = new Normalizer(this.transcript)
    this.requests = new Requests({
      opened: (request) => {
        this.transcript.emit({ type: 'request.opened', request })
        this.env.notify(this, 'request', request.title ?? request.displayName ?? request.toolName)
        this.changed()
      },
      resolved: (requestId, by, outcome) => (this.transcript.emit({ type: 'request.resolved', requestId, by, outcome }), this.changed()),
      cancelled: (requestId) => (this.transcript.emit({ type: 'request.cancelled', requestId }), this.changed())
    })
  }

  get status(): TabStatus {
    if (this.lifecycle !== 'live') return this.lifecycle
    if (this.requests.size) return 'requires_action'
    return this.turnRunning ? 'running' : 'idle'
  }

  // True while a CLI process exists or is about to (counts against maxLiveSessions).
  get holdsProcess(): boolean {
    return this.session !== undefined || this.lifecycle === 'starting'
  }

  // A process is starting or running a turn (fork and session deletion are refused meanwhile).
  get busy(): boolean {
    return this.status === 'starting' || this.status === 'running' || this.status === 'requires_action'
  }

  // What survives a restart (the tab comes back dormant).
  persisted(): PersistedTab {
    const { tabId, title, cwd, sessionId, model, effort, mode, cachedModels, cachedCommands, queuePause, autoTitle } = this
    return { tabId, title, cwd, sessionId, model, effort, mode, cachedModels, cachedCommands, ...(this.queue.length ? { queue: this.queue } : {}), queuePause, autoTitle }
  }

  // The stored-session uuid behind an item (fork up to that item).
  sourceUuidOf(itemId: string): string | undefined {
    return this.transcript.get(itemId)?.sourceUuid
  }

  meta(): TabMeta {
    const { tabId, title, cwd, sessionId, status, model, activeModel, effort, mode, error, queuePause } = this
    const queue = this.queue.map(({ queueId, text, from, images }) => ({ queueId, text, from, images: images?.length }))
    return { tabId, title, cwd, sessionId, status, model, activeModel, effort, mode, error, queue, queuePause, pendingRequests: this.requests.size }
  }

  // Subscribes a connection to the transcript (loading a resumed session's history first, without a process).
  async subscribe(send: Send, position?: StreamPosition): Promise<void> {
    await this.loadHistory()
    this.transcript.stream.attach(send, position)
  }

  unsubscribe(send: Send): void {
    this.transcript.stream.detach(send)
  }

  // The tab's folder, canonical and trusted (needs_trust otherwise), for the file explorer; starts no process.
  folder(): Promise<string> {
    return this.env.prepareStart(this.cwd)
  }

  // Sends a user message. While Claude works it goes to the CLI at once with priority 'next' (read at its next step,
  // as in the terminal) and its item stays pending until the CLI reads it.
  async send(message: Outgoing): Promise<void> {
    this.assertOpen()
    if (message.text.trim()) this.env.promptSent(this, message.text)
    if (!this.turnRunning) return this.deliver(message)
    const session = await this.ensureSession()
    if (!this.transcript.has(message.queueId)) this.dispatch(session, message, true)
  }

  // Adds a message to the queue: it goes at once if Claude is free and the queue is not paused.
  queueAdd(message: Outgoing): void {
    this.assertOpen()
    this.queue.push(message)
    this.changed()
    this.dispatchNext()
  }

  // Changes the text of a queued message (an image-only one may lose its text).
  queueEdit(queueId: string, text: string): void {
    const message = this.queued(queueId)
    if (!text.trim() && !message.images?.length) throw new CoreError('invalid_args', 'empty message')
    message.text = text
    this.changed()
  }

  // Moves a queued message to a position (clamped to the end).
  queueMove(queueId: string, index: number): void {
    const message = this.queued(queueId)
    this.queue = this.queue.filter((other) => other !== message)
    this.queue.splice(Math.min(index, this.queue.length), 0, message)
    this.changed()
  }

  unqueue(queueId: string): void {
    this.queue = this.queue.filter((message) => message.queueId !== queueId)
    this.changed()
  }

  // Takes a message out of the queue and sends it now: read at Claude's next step, nothing interrupted.
  async sendNow(queueId: string): Promise<void> {
    const message = this.queued(queueId)
    this.unqueue(queueId)
    await this.send(message).catch((error: unknown) => {
      this.queue.unshift(message)
      this.changed()
      throw error
    })
  }

  // ⏸ / ▶ of the queue; ▶ also ends a pause after Stop or a usage limit.
  setQueuePaused(paused: boolean): void {
    this.queuePause = paused ? { reason: 'user' } : undefined
    this.changed()
    this.dispatchNext()
  }

  // The queue waits (after Stop, or a usage limit); a pause made by hand stays as it is.
  pauseQueue(pause: QueuePause): void {
    if (this.queuePause?.reason === 'user') return
    this.queuePause = pause
    this.changed()
  }

  // Ends a pause of that kind (the usage limit has reset) and lets the queue go on.
  resumeQueue(reason: QueuePause['reason']): void {
    if (this.queuePause?.reason !== reason) return
    this.queuePause = undefined
    this.changed()
    this.dispatchNext()
  }

  // Stops the running turn (the queue then waits for ▶), or the running `!` command. Messages already sent and not
  // read yet stay sent: the CLI runs them next.
  async interrupt(): Promise<void> {
    if (this.shellAbort) return this.shellAbort.abort()
    if (this.queue.length && this.turnRunning) this.pauseQueue({ reason: 'stop' })
    await this.session?.query.interrupt().catch((error: unknown) => {
      throw new CoreError('sdk_error', messageOf(error))
    })
  }

  // "Send now" on a message the CLI has not read yet: the CLI's own send-now (an interrupt request with send_now and
  // the message's uuid, capability interrupt_send_now_v1): it moves what the turn waits on to the background, or ends
  // the turn, so that Claude reads the message now. The SDK 0.3.287 types do not have it: it goes through the Query's
  // control request. A CLI without the capability takes it as a plain interrupt. The queue is not paused.
  async sendPendingNow(itemId: string): Promise<void> {
    const item = this.transcript.get(itemId)
    if (item?.kind !== 'user' || !item.pending || !this.session) throw new CoreError('invalid_args', 'not a message waiting to be read')
    const query = this.session.query as unknown as { request(request: object): Promise<unknown> }
    await query.request({ subtype: 'interrupt', send_now: true, message_uuid: itemId }).catch((error: unknown) => {
      throw new CoreError('sdk_error', messageOf(error))
    })
  }

  // Runs a `!` command in the folder (trust gate first, through the session start). The output becomes a shell item
  // and, as in the CLI's bash mode, two transcript-only messages (no turn) that Claude reads with the next prompt.
  // uuid: the cmd id (item id and stored message uuid).
  async shell(command: string, uuid: string): Promise<{ exitCode: number }> {
    this.assertOpen()
    if (this.turnRunning) throw new CoreError('session_busy', 'wait for the turn to end')
    this.turnRunning = true
    this.changed()
    try {
      const session = await this.ensureSession()
      this.env.promptSent(this, `!${command}`)
      const item = { kind: 'shell' as const, itemId: uuid, sourceUuid: uuid, command, output: '' }
      this.transcript.add(item)
      this.shellAbort = new AbortController()
      const { stdout, stderr, exitCode } = await runShell(command, this.cwd, this.shellAbort.signal)
      this.transcript.update({ ...item, output: [stdout, stderr].map((text) => text.trimEnd()).filter(Boolean).join('\n'), exitCode })
      this.silentResults += 2
      const outputUuid = randomUUID()
      this.silentUuids.add(uuid).add(outputUuid)
      session.push(transcriptOnly(uuid, `<bash-input>${command}</bash-input>`))
      session.push(transcriptOnly(outputUuid, `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>`))
      return { exitCode }
    } finally {
      this.shellAbort = undefined
      this.turnRunning = false
      this.dispatchNext()
      this.changed()
    }
  }

  // Files and folders of the tab's folder for an `@` mention (trusted folders only; starts no process).
  async suggestFiles(query: string): Promise<string[]> {
    return suggestFiles(await this.folder(), query)
  }

  // Changes the model: live → setModel; dormant → only stored, passed at spawn. undefined = default model.
  // An effort level the new model does not offer moves to its highest one below.
  async setModel(model: string | undefined): Promise<void> {
    this.model = model
    this.changed()
    if (this.session) await this.session.query.setModel(model).catch((error: unknown) => this.sdkFailure('Model change failed', error))
    const levels = this.cachedModels?.find((info) => info.value === (model ?? 'default'))?.supportedEffortLevels
    const effort = fitEffort(this.effort, levels)
    if (effort !== this.effort) await this.setEffort(effort)
  }

  // Changes the reasoning effort: live → applyFlagSettings (as /effort); dormant → stored, passed at spawn.
  // undefined = the model's default.
  async setEffort(effort: Effort | undefined): Promise<void> {
    this.effort = effort
    this.changed()
    if (!this.session) return
    await this.session.query.applyFlagSettings({ effortLevel: effort ?? null }).catch((error: unknown) => this.sdkFailure('Effort change failed', error))
  }

  // Changes the permission mode. Calls are chained; a rejection falls back to the last confirmed mode.
  async setMode(mode: PermissionMode): Promise<void> {
    this.mode = mode
    this.changed()
    const session = this.session
    if (!session) {
      this.confirmedMode = mode
      return
    }
    this.modeCallsInFlight++
    const call = this.modeChain.then(() => session.query.setPermissionMode(mode))
    this.modeChain = call.catch(() => undefined)
    try {
      await call
      this.confirmedMode = mode
    } catch (error) {
      this.mode = this.confirmedMode
      this.sdkFailure('Mode change failed', error)
    } finally {
      this.modeCallsInFlight--
      this.changed()
    }
  }

  // Models offered by the CLI (live session, else cache, else starts the process).
  async models(): Promise<ModelInfo[]> {
    if (!this.session && this.cachedModels) return this.cachedModels
    const session = await this.ensureSession()
    this.cachedModels = await session.query.supportedModels()
    return this.cachedModels
  }

  // Commands runnable as a prompt, internal `__` ones hidden (live session, else cache, else starts the process).
  async commands(): Promise<SlashCommand[]> {
    if (!this.session && this.cachedCommands) return this.cachedCommands
    const session = await this.ensureSession()
    this.cachedCommands = visibleCommands(await session.query.supportedCommands())
    return this.cachedCommands
  }

  // Answers an open request. by: the answering client. A mode set by the answer becomes the tab's mode.
  answer(requestId: string, answer: Answer, by: string): void {
    const mode = modeSetBy(this.requests.answer(requestId, answer, by))
    if (mode) this.adoptMode(mode)
  }

  history(beforeItemId: string, limit: number): { items: Item[]; hasMore: boolean } {
    return this.transcript.history(beforeItemId, limit)
  }

  // Renames the tab and, if it has one, its stored session.
  async rename(title: string): Promise<void> {
    this.title = title
    this.autoTitle = false
    this.changed()
    if (this.sessionId) await this.env.sdk.renameSession(this.sessionId, title, { dir: this.cwd })
  }

  // Restarts a tab whose process ended: the transcript is reloaded from the stored session (new epoch), then
  // the session resumes with the same id.
  async restart(): Promise<void> {
    this.assertOpen()
    if (this.session) return
    this.historyPromise = undefined
    this.liveStarted = false
    this.normalizer = new Normalizer(this.transcript)
    this.transcript.clear()
    await this.ensureSession()
  }

  // The folder's trust changed: a tab waiting for it can try to start again (and its queue go on).
  trustChanged(): void {
    if (this.lifecycle !== 'needs_trust') return
    this.lifecycle = 'dormant'
    this.changed()
    this.dispatchNext()
  }

  // Closes the tab: discards the queue (kept when the app quits: keepQueue), denies requests, waits for a start in
  // progress, stops the process.
  close(keepQueue = false): Promise<void> {
    this.closePromise ??= (async () => {
      this.lifecycle = 'closing'
      if (!keepQueue) this.queue = []
      this.changed()
      this.requests.denyAll('Session closed')
      await this.startPromise?.catch(() => undefined)
      await this.session?.close(this.env.closeTimeoutMs)
      this.transcript.dispose()
    })()
    return this.closePromise
  }

  // Loads the stored history of a resumed session once (frozen: re-reading a live session would duplicate).
  // Once a process ran in this core, the transcript already holds everything: never read it again (a new
  // session gets its id from init, after its items are live).
  private loadHistory(): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId || this.liveStarted) return Promise.resolve()
    const dir = { dir: this.cwd }
    this.historyPromise ??= Promise.all([this.env.sdk.getSessionMessages(sessionId, dir), this.env.sdk.getSessionInfo(sessionId, dir)]).then(([messages, info]) => {
      this.historyModified = info?.lastModified
      this.transcript.rebuildFrom(() => messages.forEach((message) => this.normalizer.history(message)))
    })
    return this.historyPromise
  }

  // Before the first spawn: if the stored session changed since its history was read (a terminal CLI wrote to
  // it), the history is read again. No live items exist yet, so nothing can duplicate.
  private async refreshHistory(): Promise<void> {
    await this.loadHistory()
    if (!this.sessionId || this.liveStarted) return
    const info = await this.env.sdk.getSessionInfo(this.sessionId, { dir: this.cwd })
    if (!info || info.lastModified === this.historyModified) return
    this.historyPromise = undefined
    this.normalizer = new Normalizer(this.transcript)
    await this.loadHistory()
  }

  // The live session, starting it once even when several callers ask at the same time.
  private ensureSession(): Promise<Session> {
    if (this.session) return Promise.resolve(this.session)
    this.startPromise ??= this.startSession().finally(() => (this.startPromise = undefined))
    return this.startPromise
  }

  // Fresh history, prepareStart (canonical cwd, roots, trust gate), then spawn. An untrusted folder leaves the
  // tab in needs_trust: the UI shows the trust dialog, and trust.grant brings it back to dormant.
  private async startSession(): Promise<Session> {
    const previous = this.lifecycle === 'needs_trust' ? 'dormant' : this.lifecycle
    this.env.checkCanStart()
    this.lifecycle = 'starting'
    this.changed()
    try {
      await this.refreshHistory()
      this.cwd = await this.env.prepareStart(this.cwd)
      this.assertOpen()
      const session = new Session(this.env.sdk.query, this.sessionOptions(), {
        message: (message) => this.onMessage(message),
        handlerError: (error) => this.notice('warning', `Internal error while reading the session: ${messageOf(error)}`),
        processStarted: (pid, startedAt) => this.env.processStarted(pid, startedAt),
        processExited: (pid) => this.env.processExited(pid)
      })
      this.session = session
      this.liveStarted = true
      void session.exited.then((error) => this.onExit(session, error))
      this.lifecycle = 'live'
      this.error = undefined
      this.changed()
      return session
    } catch (error) {
      const untrusted = error instanceof CoreError && error.code === 'needs_trust'
      if (this.lifecycle === 'starting') this.lifecycle = untrusted ? 'needs_trust' : previous
      this.changed()
      throw error
    }
  }

  private sessionOptions(): Options {
    return {
      ...BASE_OPTIONS,
      ...this.env.sdkOptions,
      cwd: this.cwd,
      resume: this.sessionId,
      model: this.model,
      effort: this.effort,
      permissionMode: this.mode,
      canUseTool: this.requests.ask
    }
  }

  // Starts a turn with a message (starting the session if needed).
  private async deliver(message: Outgoing): Promise<void> {
    this.turnRunning = true
    try {
      const session = await this.ensureSession()
      // Already delivered (a retry after a core restart): the stored history, loaded at start, contains it.
      if (this.transcript.has(message.queueId)) this.turnRunning = false
      else this.dispatch(session, message, false)
    } catch (error) {
      this.turnRunning = false
      throw error
    } finally {
      this.changed()
    }
  }

  // Appends the user item (images moved to the blob store) and hands the message to the CLI, stamped as human input.
  // midTurn: Claude is working, so the CLI reads it at its next step; the item is pending until then.
  private dispatch(session: Session, { queueId, text, from, images = [], pastes = [] }: Outgoing, midTurn: boolean): void {
    const refs = images.map((image) => ({ imageId: this.transcript.addBlob(image), mediaType: image.mediaType }))
    this.transcript.add({ kind: 'user', itemId: queueId, sourceUuid: queueId, text, from, ...(refs.length ? { images: refs } : {}), ...(midTurn ? { pending: true } : {}) })
    const blocks = images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } }))
    const content = blocks.length ? [...blocks, ...(text ? [{ type: 'text' as const, text }] : [])] : text
    session.push({
      type: 'user',
      // queueId is the client's cmd id, validated as a UUID by the protocol.
      uuid: queueId as SDKUserMessage['uuid'],
      message: { role: 'user', content },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
      ...(midTurn ? { priority: 'next' as const } : {}),
      ...(pastes.length ? { inline_pastes: pastes } : {})
    })
    this.changed()
  }

  // The head of the queue goes when Claude is free (no turn, no message held by the CLI, no request) and the queue
  // does not wait. A failure puts it back (needs_trust: it goes once the folder is trusted).
  private dispatchNext(): void {
    const free = !this.turnRunning && !this.held.size && !this.requests.size && this.lifecycle !== 'closing' && this.lifecycle !== 'starting'
    if (!free || this.queuePause || !this.queue.length) return
    const next = this.queue.shift()!
    this.changed()
    this.deliver(next).catch((error: unknown) => {
      this.queue.unshift(next)
      this.changed()
      if (!(error instanceof CoreError && error.code === 'needs_trust')) this.notice('error', `The queued message could not be sent: ${messageOf(error)}`)
    })
  }

  // Applies one SDK message: transcript items via the normalizer, metadata here. The empty results of
  // transcript-only messages are dropped (they end no turn; the probe checks the CLI still sends them).
  private onMessage(message: SDKMessage): void {
    if (isCommandLifecycle(message)) return this.onCommandLifecycle(message)
    if (message.type === 'result' && this.silentResults > 0 && message.num_turns === 0) return void this.silentResults--
    this.normalizer.live(message)
    if (message.type === 'system' && message.subtype === 'init') {
      this.setSessionId(message.session_id)
      this.activeModel = message.model
      this.adoptMode(message.permissionMode, true)
    } else if (message.type === 'system' && message.subtype === 'status' && message.permissionMode) {
      this.adoptMode(message.permissionMode, true)
    } else if (message.type === 'system' && message.subtype === 'commands_changed') {
      this.cachedCommands = visibleCommands(message.commands)
    } else if (message.type === 'conversation_reset') {
      this.resetConversation(message.new_conversation_id)
    } else if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected' && message.rate_limit_info.resetsAt) {
      this.env.rateLimited(message.rate_limit_info.resetsAt * 1000)
    } else if (message.type === 'result') {
      this.endTurn()
    }
  }

  // What the CLI says of a sent message: queued, started (read: no longer pending; a turn the CLI starts by itself
  // makes the tab work), completed or cancelled.
  private onCommandLifecycle({ command_uuid: uuid, state }: CommandLifecycle): void {
    const done = state === 'completed' || state === 'cancelled'
    if (this.silentUuids.has(uuid)) return void (done && this.silentUuids.delete(uuid))
    if (done) return void this.held.delete(uuid)
    this.held.set(uuid, state)
    if (state !== 'started') return
    const item = this.transcript.get(uuid)
    if (item?.kind === 'user' && item.pending) {
      const { pending: _read, ...read } = item
      this.transcript.update(read)
    }
    if (this.turnRunning) return
    this.turnRunning = true
    this.changed()
  }

  // End of a turn. What the CLI read in it is done; a message it has not read yet runs right after as its own turn,
  // so the tab keeps working. Otherwise the turn is over and the next queued message goes (unless the queue waits).
  private endTurn(): void {
    for (const [uuid, state] of this.held) if (state === 'started') this.held.delete(uuid)
    if (this.held.size) return this.changed()
    this.turnRunning = false
    this.env.turnFinished(this)
    this.env.notify(this, 'turnFinished')
    this.dispatchNext()
    this.changed()
    void this.followCliTitle()
  }

  // The CLI's own title of the session (its generated title, a /rename, or at first the first prompt), while the tab
  // has no title given by the user.
  private async followCliTitle(): Promise<void> {
    if (!this.autoTitle || !this.sessionId) return
    const info = await this.env.sdk.getSessionInfo(this.sessionId, { dir: this.cwd }).catch(() => undefined)
    const title = info?.customTitle || info?.summary
    if (!title || title === this.title || !this.autoTitle) return
    this.title = title
    this.changed()
  }

  // /clear and friends: the session id moves, the title resets, the transcript starts empty with a new epoch.
  private resetConversation(newSessionId: string): void {
    this.setSessionId(newSessionId)
    this.title = basename(this.cwd) || this.cwd
    this.autoTitle = true
    this.normalizer = new Normalizer(this.transcript)
    this.transcript.clear()
    this.changed()
  }

  // The process ended. Closed by us → nothing to do; on its own → error with the stderr tail (or dormant
  // after a clean exit), transcript kept, open requests cancelled. The next send starts it again (resume).
  private onExit(session: Session, error: Error | undefined): void {
    if (this.session !== session) return
    this.session = undefined
    this.turnRunning = false
    this.held.clear()
    if (this.lifecycle === 'closing') return
    this.lifecycle = error ? 'error' : 'dormant'
    this.error = error ? [error.message, session.stderrTail].filter(Boolean).join('\n') : undefined
    this.requests.denyAll('The Claude process exited')
    if (this.error) {
      this.notice('error', this.error)
      this.env.notify(this, 'error', this.error)
    }
    this.changed()
  }

  // A mode change decided by the CLI (or an answered request). fromCli: an in-flight change of ours wins.
  private adoptMode(mode: PermissionMode, fromCli = false): void {
    this.confirmedMode = mode
    if (!fromCli || !this.modeCallsInFlight) this.mode = mode
    this.changed()
  }

  private setSessionId(sessionId: string): void {
    if (sessionId === this.sessionId) return
    const previous = this.sessionId
    this.sessionId = sessionId
    this.env.sessionIdChanged(this, previous)
    this.changed()
  }

  // A queued message by id, or not_found.
  private queued(queueId: string): Outgoing {
    const message = this.queue.find((entry) => entry.queueId === queueId)
    if (!message) throw new CoreError('not_found', 'message no longer queued')
    return message
  }

  // Records a failed SDK call as a notice and turns it into an sdk_error reply.
  private sdkFailure(what: string, error: unknown): never {
    this.notice('error', `${what}: ${messageOf(error)}`)
    throw new CoreError('sdk_error', messageOf(error))
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.transcript.add({ kind: 'notice', itemId: `notice-${this.transcript.stream.seq + 1}-${Date.now()}`, level, text })
  }

  private assertOpen(): void {
    if (this.lifecycle === 'closing') throw new CoreError('not_found', 'tab is closing')
  }

  private changed(): void {
    this.env.changed(this)
  }
}

// A message appended to the conversation without starting a turn (the CLI merges it into the next prompt).
const transcriptOnly = (uuid: string, content: string): SDKUserMessage => ({
  type: 'user',
  uuid: uuid as SDKUserMessage['uuid'],
  message: { role: 'user', content },
  parent_tool_use_id: null,
  shouldQuery: false
})

// Commands without the CLI's internal `__` ones.
const visibleCommands = (commands: SlashCommand[]) => commands.filter((command) => !command.name.startsWith('__'))

// The effort kept on a model change (the prototype's rule, like the CLI's silent downgrade): the same if the model
// offers it, else its highest level below (its lowest if none is below); unchanged when the model does not say.
export function fitEffort(effort: Effort | undefined, levels: readonly Effort[] | undefined): Effort | undefined {
  if (!effort || !levels?.length || levels.includes(effort)) return effort
  const rank = (level: Effort) => EFFORT_LEVELS.indexOf(level)
  const descending = [...levels].sort((a, b) => rank(b) - rank(a))
  return descending.find((level) => rank(level) < rank(effort)) ?? descending.at(-1)
}

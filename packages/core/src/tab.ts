import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { tabStream, type Image, type Item, type ModelInfo, type PermissionMode, type SlashCommand, type StreamPosition, type TabMeta, type TabStatus } from '@claude-wrap/protocol'
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
}

// A user message on its way: queueId is the cmd id (SDK message uuid); pastes are long pasted texts inside text.
export type Outgoing = { queueId: string; text: string; from: string; images?: Image[]; pastes?: string[] }

export type TabInit = {
  tabId: string
  cwd: string
  resume?: string
  title?: string
  model?: string
  mode?: PermissionMode
  cachedModels?: ModelInfo[]
  cachedCommands?: SlashCommand[]
}

// Lifecycle of the tab's process; the visible status adds the turn state on top of `live`.
type Lifecycle = 'dormant' | 'starting' | 'live' | 'closing' | 'needs_trust' | 'error'

// One tab: metadata, transcript, open requests, message queue, and the lazily started CLI session.
// Viewing never starts a process: only sending (or asking models/commands with nothing cached) does.
export class Tab {
  readonly tabId: string
  // Canonicalized by prepareStart at every spawn.
  cwd: string
  readonly transcript: Transcript
  title: string
  sessionId?: string
  model?: string
  activeModel?: string
  mode: PermissionMode
  private confirmedMode: PermissionMode
  private lifecycle: Lifecycle = 'dormant'
  private turnRunning = false
  private error?: string
  private queue: Outgoing[] = []
  // "Send now" interrupted the turn: the head of the queue goes out even though the turn ended aborted.
  private sendNowPending = false
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
    this.sessionId = init.resume
    this.model = init.model
    this.mode = this.confirmedMode = init.mode ?? 'default'
    this.cachedModels = init.cachedModels
    this.cachedCommands = init.cachedCommands
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
    const { tabId, title, cwd, sessionId, model, mode, cachedModels, cachedCommands } = this
    return { tabId, title, cwd, sessionId, model, mode, cachedModels, cachedCommands }
  }

  // The stored-session uuid behind an item (fork up to that item).
  sourceUuidOf(itemId: string): string | undefined {
    return this.transcript.get(itemId)?.sourceUuid
  }

  meta(): TabMeta {
    const { tabId, title, cwd, sessionId, status, model, activeModel, mode, error } = this
    const queue = this.queue.map(({ queueId, text, from, images }) => ({ queueId, text, from, images: images?.length }))
    return { tabId, title, cwd, sessionId, status, model, activeModel, mode, error, queue, pendingRequests: this.requests.size }
  }

  // Subscribes a connection to the transcript (loading a resumed session's history first, without a process).
  async subscribe(send: Send, position?: StreamPosition): Promise<void> {
    await this.loadHistory()
    this.transcript.stream.attach(send, position)
  }

  unsubscribe(send: Send): void {
    this.transcript.stream.detach(send)
  }

  // Sends a user message, or queues it while a turn runs (or a queue waits after an interrupt).
  async send(message: Outgoing): Promise<{ queued: boolean }> {
    this.assertOpen()
    if (message.text.trim()) this.env.promptSent(this, message.text)
    if (this.turnRunning || this.queue.length) {
      this.queue.push(message)
      this.changed()
      return { queued: true }
    }
    await this.deliver(message)
    return { queued: false }
  }

  unqueue(queueId: string): void {
    this.queue = this.queue.filter((message) => message.queueId !== queueId)
    this.changed()
  }

  // Sends a queued message now: a running turn is interrupted and the message goes out when it ends; with no turn
  // running (the queue waits after an interrupt) it goes out at once.
  async sendNow(queueId: string): Promise<void> {
    const message = this.queue.find((entry) => entry.queueId === queueId)
    if (!message) throw new CoreError('not_found', 'message no longer queued')
    this.queue = [message, ...this.queue.filter((entry) => entry !== message)]
    this.changed()
    if (this.turnRunning) {
      this.sendNowPending = true
      return this.interrupt()
    }
    this.queue.shift()
    await this.deliver(message).catch((error: unknown) => {
      this.queue.unshift(message)
      throw error
    })
  }

  // Stops the running turn, or the running `!` command.
  async interrupt(): Promise<void> {
    if (this.shellAbort) return this.shellAbort.abort()
    await this.session?.query.interrupt().catch((error: unknown) => {
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
      session.push(transcriptOnly(uuid, `<bash-input>${command}</bash-input>`))
      session.push(transcriptOnly(randomUUID(), `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>`))
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
    return suggestFiles(await this.env.prepareStart(this.cwd), query)
  }

  // Changes the model: live → setModel; dormant → only stored, passed at spawn. undefined = default model.
  async setModel(model: string | undefined): Promise<void> {
    this.model = model
    this.changed()
    if (!this.session) return
    await this.session.query.setModel(model).catch((error: unknown) => this.sdkFailure('Model change failed', error))
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

  // The folder's trust changed: a tab waiting for it can try to start again.
  trustChanged(): void {
    if (this.lifecycle !== 'needs_trust') return
    this.lifecycle = 'dormant'
    this.changed()
  }

  // Closes the tab: discards the queue, denies requests, waits for a start in progress, stops the process.
  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.lifecycle = 'closing'
      this.queue = []
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
      else this.dispatch(session, message)
    } catch (error) {
      this.turnRunning = false
      throw error
    } finally {
      this.changed()
    }
  }

  // Appends the user item (images moved to the blob store) and hands the message to the CLI, stamped as human input.
  private dispatch(session: Session, { queueId, text, from, images = [], pastes = [] }: Outgoing): void {
    const refs = images.map((image) => ({ imageId: this.transcript.addBlob(image), mediaType: image.mediaType }))
    this.transcript.add({ kind: 'user', itemId: queueId, sourceUuid: queueId, text, from, ...(refs.length ? { images: refs } : {}) })
    const blocks = images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } }))
    const content = blocks.length ? [...blocks, ...(text ? [{ type: 'text' as const, text }] : [])] : text
    session.push({
      type: 'user',
      // queueId is the client's cmd id, validated as a UUID by the protocol.
      uuid: queueId as SDKUserMessage['uuid'],
      message: { role: 'user', content },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
      ...(pastes.length ? { inline_pastes: pastes } : {})
    })
    this.changed()
  }

  // The next queued message goes out, if the session is live and no turn runs.
  private dispatchNext(): void {
    const next = this.session && !this.turnRunning ? this.queue.shift() : undefined
    if (!next) return
    this.turnRunning = true
    this.dispatch(this.session!, next)
  }

  // Applies one SDK message: transcript items via the normalizer, metadata here. The empty results of
  // transcript-only messages are dropped (they end no turn; the probe checks the CLI still sends them).
  private onMessage(message: SDKMessage): void {
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
    } else if (message.type === 'result') {
      this.endTurn(message.subtype !== 'success' && Boolean(message.terminal_reason?.startsWith('aborted')))
    }
  }

  // End of a turn: the next queued message goes out, unless the turn was interrupted (the queue then waits) by
  // anything but "send now".
  private endTurn(interrupted: boolean): void {
    this.turnRunning = false
    this.env.turnFinished(this)
    this.env.notify(this, 'turnFinished')
    if (!interrupted || this.sendNowPending) this.dispatchNext()
    this.sendNowPending = false
    this.changed()
  }

  // /clear and friends: the session id moves, the title resets, the transcript starts empty with a new epoch.
  private resetConversation(newSessionId: string): void {
    this.setSessionId(newSessionId)
    this.title = basename(this.cwd) || this.cwd
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

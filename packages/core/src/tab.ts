import { randomUUID } from 'node:crypto'
import { basename, isAbsolute, relative } from 'node:path'
import type { Options, SDKMessage, SDKResultMessage, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  EFFORT_LEVELS,
  tabStream,
  type ContextGauge,
  type ContextUsage,
  type Effort,
  type Image,
  type Item,
  type ModelInfo,
  type PermissionMode,
  type PlanLimits,
  type QueuePause,
  type SlashCommand,
  type StreamPosition,
  type TabMeta,
  type TabStatus,
  type Usage
} from '@athome/protocol'
import type { Notice, SdkApi } from './config.ts'
import { CoreError, messageOf } from './errors.ts'
import { suggestFiles } from './fileSuggestions.ts'
import { Normalizer, peerOf, storedPeer } from './normalize.ts'
import { runShell } from './process.ts'
import { Requests, modeSetBy, type Answer } from './requests.ts'
import { Session } from './session.ts'
import type { PersistedTab } from './state.ts'
import type { Send } from './stream.ts'
import { Transcript, type TranscriptOptions } from './transcript.ts'
import { planLimitsFromEvent, readUsage, toContextGauge, toContextUsage, toPlanLimits, toUsage } from './usage.ts'

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
  // The next queued message waits this long (ms) while its chat is on screen (watched).
  queueCountdownMs: number
  watched(tabId: string): boolean
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
  // A usage limit of an account (undefined = the login) until `until` (ms); limitedUntil: when it ends, if limited.
  rateLimited(until: number, account: string | undefined): void
  // A turn of that account went through: its usage limit, if any, is over.
  limitLifted(account: string | undefined): void
  limitedUntil(account: string | undefined): number | undefined
  // Plan windows per account (composer gauges): the last read, whether a new read is due, and storing one.
  planLimits(account: string | undefined): PlanLimits | undefined
  planLimitsDue(account: string | undefined): boolean
  setPlanLimits(account: string | undefined, limits: PlanLimits | undefined): void
  // Plan windows seen in a rate_limit_event: merged over the last read, window by window.
  mergePlanLimits(account: string | undefined, limits: PlanLimits): void
  // Claude Code's auto-compact window set from the app (undefined: Claude Code's own setting).
  autoCompactWindow(): number | undefined
  // The token of an account (undefined for the login).
  accountToken(account: string | undefined): Promise<string | undefined>
}

// What a rewind gives back: the rewound prompt for the composer (conversation modes), the files it restored (code
// modes) and startOver when the target was the first message (the caller opens a fresh session for it).
export type RewindOutcome = { text?: string; images?: Image[]; filesChanged?: string[]; skippedLinks?: number; startOver?: boolean }
// A message the user can rewind to: its item id, a clamped summary of its text and its number of images.
export type RewindPoint = { itemId: string; text: string; images?: number }
// Longest text of a rewind point (chars).
const REWIND_TEXT = 200

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
  // The Claude account (undefined = Claude Code's own login).
  account?: string
  // Stopped mid-work by a usage limit or an account switch.
  interrupted?: 'limit' | 'switch'
  // The context window after the last turn.
  context?: ContextGauge
  // When the tab was last used (ms).
  lastUsedAt?: number
  // Claude finished while nobody looked at the chat.
  unseen?: boolean
  // After a conversation rewind: the stored message the next process resumes at (everything after it is dropped).
  resumeAt?: string
}

// Longest title taken from the CLI (chars). Its "summary" is its generated title, but for some sessions (long ones,
// before a title exists) it falls back to a prompt: a longer text is not a title and is not adopted.
export const MAX_AUTO_TITLE = 80

// The CLI's title of a stored session: its custom title (/rename), else its summary when short enough to be a title.
export function cliTitle(info: { customTitle?: string; summary?: string } | undefined): string | undefined {
  const summary = info?.summary?.trim()
  return info?.customTitle || (summary && summary.length <= MAX_AUTO_TITLE ? summary : undefined)
}

// A turn the CLI starts for a message core did not send (e.g. from another session): its live messages wait at most
// this long (ms) while that message is looked up in the stored session, which the CLI writes in batches (~100 ms).
const INCOMING_WAIT_MS = 1500
// Pauses before each lookup of that message (ms): at once, then while the CLI has not written it yet.
const INCOMING_RETRIES_MS = [0, 150, 250, 500]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Words of the first prompt a tab is named after when the CLI generated no title.
const PROMPT_TITLE_WORDS = 3

// The title a tab takes from its session, like the Claude app: the CLI's title (generated after the first prompt, or
// a rename; getSessionInfo reports both as customTitle), else the first words of the first prompt.
export function tabTitle(info: { customTitle?: string; firstPrompt?: string } | undefined): string | undefined {
  const words = info?.firstPrompt?.trim().split(/\s+/).slice(0, PROMPT_TITLE_WORDS).join(' ').replace(/[\s,.;:!?]+$/, '')
  return info?.customTitle?.trim() || words || undefined
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
  // The Claude account (undefined = Claude Code's own login); switchPending: the process restarts at the turn's end
  // (an account switch, a new auto-compact window).
  private account?: string
  private switchPending = false
  // The account the running process was started with: until a switch takes effect (at the end of a turn) it is not
  // `account`, and what the process reports (limits, plan windows) belongs to it.
  private processAccount?: string
  // A usage limit was reported during the current turn (a turn that ends without one lifts the account's limit).
  private turnRejected = false
  // Claude was stopped mid-work by a usage limit or an account switch, until "Continua" or a message of the user.
  private interrupted?: 'limit' | 'switch'
  // The context window after the last turn (composer gauge).
  private contextGauge?: ContextGauge
  // When the tab was last used (ms): opened, or a message sent or queued.
  lastUsedAt?: number
  // Claude finished (or stopped with an error) while nobody looked at the chat (set and cleared by the workspace).
  private unseenFinish: boolean
  // The countdown of the next queued message, while its chat is on screen.
  private countdown?: { queueId: string; until: number; timer: NodeJS.Timeout }
  sessionId?: string
  model?: string
  activeModel?: string
  effort?: Effort
  mode: PermissionMode
  private confirmedMode: PermissionMode
  private lifecycle: Lifecycle = 'dormant'
  private turnRunning = false
  // Work time of the turn (see TabMeta.workingSince): kept by updateWorkClock; workedMs while Claude waits.
  private workingSince?: number
  private workedMs = 0
  private error?: string
  private queue: Outgoing[]
  private queuePause?: QueuePause
  // Messages the CLI holds (command_lifecycle), from queued or started until completed or cancelled.
  private readonly held = new Map<string, 'queued' | 'started'>()
  // The message the running turn answers when the CLI started it by itself (e.g. a message from another session).
  private incoming?: string
  // The live messages held while that message is looked up, so that it shows before the answer (lookUpIncoming).
  private waitingMessages?: SDKMessage[]
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
  // A rewind is in progress (the tab counts as busy; sending and starting a queued message wait).
  private rewinding = false
  // The stored message the next process resumes at, from a conversation rewind until that process reports init.
  private resumeAt?: string

  constructor(init: TabInit, env: TabEnvironment) {
    this.env = env
    this.tabId = init.tabId
    this.cwd = init.cwd
    this.title = init.title || basename(init.cwd) || init.cwd
    this.autoTitle = init.autoTitle ?? !init.title
    this.account = init.account
    this.interrupted = init.interrupted
    this.contextGauge = init.context
    this.lastUsedAt = init.lastUsedAt
    this.unseenFinish = init.unseen ?? false
    this.sessionId = init.resume
    this.resumeAt = init.resumeAt
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
    return this.rewinding || this.status === 'starting' || this.status === 'running' || this.status === 'requires_action'
  }

  // What survives a restart (the tab comes back dormant).
  persisted(): PersistedTab {
    const { tabId, title, cwd, sessionId, model, effort, mode, cachedModels, cachedCommands, queuePause, autoTitle, account, interrupted, lastUsedAt, resumeAt } = this
    const context = this.contextGauge
    return { tabId, title, cwd, sessionId, model, effort, mode, cachedModels, cachedCommands, ...(this.queue.length ? { queue: this.queue } : {}), queuePause, autoTitle, account, interrupted, context, lastUsedAt, ...(resumeAt ? { resumeAt } : {}), ...(this.unseenFinish ? { unseen: true } : {}) }
  }

  // The stored-session uuid behind an item (fork up to that item).
  sourceUuidOf(itemId: string): string | undefined {
    return this.transcript.get(itemId)?.sourceUuid
  }

  meta(): TabMeta {
    this.updateWorkClock()
    const { tabId, title, cwd, sessionId, status, model, activeModel, effort, mode, error, queuePause, account, interrupted, lastUsedAt, workingSince } = this
    const limitedUntil = this.env.limitedUntil(account)
    const planLimits = this.env.planLimits(account)
    const context = this.contextGauge
    const queueCountdown = this.countdown && { queueId: this.countdown.queueId, until: this.countdown.until }
    const queue = this.queue.map(({ queueId, text, from, images }) => ({ queueId, text, from, images: images?.length }))
    return { tabId, title, cwd, sessionId, status, model, activeModel, effort, mode, error, queue, queuePause, pendingRequests: this.requests.size, account, ...(limitedUntil ? { limitedUntil } : {}), ...(interrupted ? { interrupted } : {}), ...(context ? { context } : {}), ...(planLimits ? { planLimits } : {}), ...(queueCountdown ? { queueCountdown } : {}), ...(lastUsedAt ? { lastUsedAt } : {}), ...(workingSince ? { workingSince } : {}), ...(this.unseenFinish ? { unseen: true as const } : {}) }
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
    this.assertNotRewinding()
    this.used()
    // A message of the user takes the place of "Continua".
    if (this.interrupted) this.interrupted = undefined
    this.changed()
    if (message.text.trim()) this.env.promptSent(this, message.text)
    if (!this.turnRunning) return this.deliver(message)
    const session = await this.ensureSession()
    if (!this.transcript.has(message.queueId)) this.dispatch(session, message, true)
  }

  // Adds a message to the queue: it goes at once if Claude is free and the queue is not paused.
  queueAdd(message: Outgoing): void {
    this.assertOpen()
    this.used()
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
    this.dispatchNext()
  }

  unqueue(queueId: string): void {
    this.queue = this.queue.filter((message) => message.queueId !== queueId)
    this.changed()
    this.dispatchNext()
  }

  // Stops the countdown of the next queued message: it leaves the queue and is returned for the composer; the rest of
  // the queue waits for ▶.
  holdQueued(queueId: string): { text: string; images?: Image[] } {
    if (this.countdown?.queueId !== queueId) throw new CoreError('request_resolved', 'that message is no longer waiting to go')
    const { text, images } = this.queued(queueId)
    this.stopCountdown()
    this.queue = this.queue.filter((message) => message.queueId !== queueId)
    if (this.queue.length) this.queuePause = { reason: 'user' }
    this.changed()
    return { text, ...(images?.length ? { images } : {}) }
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

  // The Claude account of the session (undefined = Claude Code's own login). The conversation stays: an idle process
  // is closed now and the next message starts one with the new account on the same stored session (as /login in the
  // terminal); a process at work is stopped now (marked 'switch': "Continua" resumes it) and closed at the end of
  // that turn. A queue held by the old account's usage limit goes on when the new account is free, unless the limit
  // stopped Claude mid-work (then it waits for "Continua").
  async setAccount(accountId: string | undefined): Promise<void> {
    this.assertOpen()
    if (accountId === this.account) return
    this.account = accountId
    if (this.queuePause?.reason === 'limit' && !this.env.limitedUntil(accountId) && !this.interrupted) this.resumeQueue('limit')
    this.changed()
    if (!this.session) return
    if (!this.busy) return this.releaseProcess()
    // Stopped now by the switch, unless a usage limit had already stopped this turn (that stays the reason).
    this.interrupted ??= 'switch'
    this.switchPending = true
    this.changed()
    await this.interrupt()
  }

  // A CLI process is running for the tab (gauges are read only from one).
  get live(): boolean {
    return Boolean(this.session)
  }

  // Claude finished while nobody looked at the chat (for the workspace: the notification count).
  get unseen(): boolean {
    return this.unseenFinish
  }

  // Marks the chat as finished and not looked at yet (true) or looked at (false); announced only when it changes.
  setUnseen(unseen: boolean): void {
    if (this.unseenFinish === unseen) return
    this.unseenFinish = unseen
    this.changed()
  }

  // Why Claude was stopped mid-work, if it was (for the workspace: "Continua" and the limit's end).
  get interruptedBy(): 'limit' | 'switch' | undefined {
    return this.interrupted
  }

  // "Continua" after a stop by a usage limit or an account switch: the mark goes, the queue's pause after the stop
  // ends, and text (if any) is sent as a message of the user; the queue goes on after it.
  async resume(text: string | undefined, from: string): Promise<void> {
    if (!this.interrupted) return
    this.interrupted = undefined
    if (this.queuePause && this.queuePause.reason !== 'user') this.queuePause = undefined
    this.changed()
    if (text) await this.send({ queueId: randomUUID(), text, from })
    else this.dispatchNext()
  }

  // The account (for the workspace: limits and removed accounts).
  get accountId(): string | undefined {
    return this.account
  }

  // Ends the CLI process, keeping the tab and its transcript: dormant at once, the next message starts a new process
  // on the same stored session.
  private async releaseProcess(): Promise<void> {
    this.switchPending = false
    const session = this.session
    if (!session) return
    this.endIncoming()
    this.session = undefined
    this.turnRunning = false
    this.held.clear()
    this.lifecycle = 'dormant'
    this.changed()
    await session.close(this.env.closeTimeoutMs)
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
    this.assertNotRewinding()
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

  // The messages of the user the chat can be rewound to, oldest first: real prompts (not waiting to be read, not from
  // another session, not `!` commands) after the last compaction, which the CLI cannot rewind across.
  rewindPoints(): RewindPoint[] {
    const items = this.transcript.all()
    const boundary = items.findLastIndex((item) => item.kind === 'compactBoundary')
    return items.slice(boundary + 1).flatMap((item) => {
      if (item.kind !== 'user' || item.pending) return []
      return [{ itemId: item.itemId, text: item.text.slice(0, REWIND_TEXT), ...(item.images?.length ? { images: item.images.length } : {}) }]
    })
  }

  // What rewinding the files to a message would change (starts the process if dormant; sends nothing).
  async rewindPreview(itemId: string): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }> {
    const target = this.rewindTarget(itemId)
    const session = await this.ensureSession()
    const { filesChanged, ...rest } = await session.query.rewindFiles(target.uuid, { dryRun: true }).catch((error: unknown) => this.sdkFailure('Rewind preview failed', error))
    return { ...rest, ...(filesChanged ? { filesChanged: filesChanged.map((path) => this.relativePath(path)) } : {}) }
  }

  // Rewinds to a message like the CLI's /rewind: the files, the conversation, or both. Refused while Claude works.
  // The conversation is cut before the message: the next process resumes at the message before it, the queue waits for
  // ▶, and the message's text and images come back for the composer. The first message has nothing before it: nothing
  // is cut and startOver is set, the caller opens a fresh session for it.
  async rewind(itemId: string, mode: 'both' | 'conversation' | 'code'): Promise<RewindOutcome> {
    this.assertOpen()
    this.assertNotRewinding()
    const target = this.rewindTarget(itemId)
    this.assertIdle()
    this.rewinding = true
    this.changed()
    try {
      const code = mode === 'conversation' ? {} : await this.rewindCode(target.uuid)
      return mode === 'code' ? code : { ...code, ...(await this.rewindConversation(target)) }
    } finally {
      this.rewinding = false
      this.changed()
      this.dispatchNext()
    }
  }

  // The user item to rewind to and its stored message uuid; not_found / invalid_args otherwise.
  private rewindTarget(itemId: string): { item: Extract<Item, { kind: 'user' }>; uuid: string } {
    const item = this.transcript.get(itemId)
    if (!item) throw new CoreError('not_found', 'message not found')
    if (item.kind !== 'user' || item.pending) throw new CoreError('invalid_args', 'not a message of the user to rewind to')
    return { item, uuid: item.sourceUuid ?? item.itemId }
  }

  // Refuses while a turn, a held message, a request or a `!` command is at work.
  private assertIdle(): void {
    if (this.turnRunning || this.held.size || this.requests.size || this.shellAbort || this.lifecycle === 'starting') throw new CoreError('session_busy', 'wait for Claude to finish before rewinding')
  }

  // Restores the files to their state at the message.
  private async rewindCode(uuid: string): Promise<RewindOutcome> {
    const session = await this.ensureSession()
    const result = await session.query.rewindFiles(uuid).catch((error: unknown) => this.sdkFailure('Rewind failed', error))
    if (!result.canRewind) throw new CoreError('sdk_error', result.error ?? 'the files cannot be rewound to this message')
    return { filesChanged: (result.filesChanged ?? []).map((path) => this.relativePath(path)), skippedLinks: result.skippedLinks ?? 0 }
  }

  // Cuts the conversation before the target (see rewind). Another session's message may have started a turn since the
  // check: it is checked again once the stored session was read.
  private async rewindConversation({ item, uuid }: { item: Extract<Item, { kind: 'user' }>; uuid: string }): Promise<RewindOutcome> {
    const before = await this.messageBefore(uuid)
    this.assertIdle()
    const images = (item.images ?? []).flatMap((ref) => this.transcript.blob(ref.imageId) ?? [])
    const prompt = { text: item.text, ...(images.length ? { images } : {}) }
    if (!before) return { ...prompt, startOver: true }
    this.resumeAt = before
    await this.releaseProcess()
    this.normalizer = new Normalizer(this.transcript)
    this.silentResults = 0
    this.silentUuids.clear()
    this.transcript.truncateAt(item.itemId)
    // The queued messages were written for the conversation as it was: they wait for ▶.
    if (this.queue.length) this.queuePause = { reason: 'user' }
    return prompt
  }

  // The stored message just before the one with uuid in the session's chain (the point to resume at), or undefined when
  // it is the first. System records and subagent messages are not resume points. not_found when uuid is not stored.
  private async messageBefore(uuid: string): Promise<string | undefined> {
    const messages = this.sessionId ? await this.env.sdk.getSessionMessages(this.sessionId, { dir: this.cwd }).catch(() => []) : []
    const position = messages.findIndex((message) => message.uuid === uuid)
    if (position < 0) throw new CoreError('not_found', 'that message is not in the stored session yet')
    return messages.slice(0, position).findLast((message) => message.type !== 'system' && !message.parent_tool_use_id)?.uuid
  }

  // A path the CLI reports, relative to the tab's folder when inside it.
  private relativePath(path: string): string {
    return isAbsolute(path) ? relative(this.cwd, path) || path : path
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
    await this.keepEffortOffered()
  }

  // Moves the effort to the highest level the model offers below it, when the model (as cached) does not offer it.
  private async keepEffortOffered(): Promise<void> {
    const levels = this.cachedModels?.find((info) => info.value === (this.model ?? 'default'))?.supportedEffortLevels
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

  // Models offered by the CLI (live session, else cache, else starts the process). Read from the CLI, they fit the
  // effort to the model (a default effort may be one it does not offer).
  async models(): Promise<ModelInfo[]> {
    if (!this.session && this.cachedModels) return this.cachedModels
    const session = await this.ensureSession()
    this.cachedModels = await session.query.supportedModels()
    await this.keepEffortOffered()
    return this.cachedModels
  }

  // Commands runnable as a prompt, internal `__` ones hidden (live session, else cache, else starts the process).
  async commands(): Promise<SlashCommand[]> {
    if (!this.session && this.cachedCommands) return this.cachedCommands
    const session = await this.ensureSession()
    this.cachedCommands = visibleCommands(await session.query.supportedCommands())
    return this.cachedCommands
  }

  // Context window of the session, as /context (live session, else starts the process).
  async contextUsage(): Promise<ContextUsage> {
    const session = await this.ensureSession()
    return toContextUsage(await session.query.getContextUsage().catch((error: unknown) => this.sdkFailure('Context usage failed', error)))
  }

  // Cost of the session and its account's plan limits, as /usage (live session, else starts the process).
  async usage(): Promise<Usage> {
    const session = await this.ensureSession()
    return toUsage(await readUsage(session.query).catch((error: unknown) => this.sdkFailure('Usage failed', error)))
  }

  // The auto-compact window changed in the app. The CLI reads it only at spawn (a live applyFlagSettings does not
  // move it, checked on CLI 2.1.287), so a live process restarts on the same stored session: an idle one now, one at
  // work at the end of its turn. A dormant one gets it at spawn.
  async applyAutoCompactWindow(): Promise<void> {
    if (!this.session) return
    if (this.busy) this.switchPending = true
    else await this.releaseProcess()
  }

  // The composer's gauges, read from the live process only (none is started): the context window (a summary answer,
  // no token counting) and, when due for its account or forced, the plan windows. Failures leave the last values.
  async refreshGauges(force = false): Promise<void> {
    const session = this.session
    if (!session) return
    const answer = await session.query.getContextUsage({ detail: 'summary' }).catch(() => undefined)
    if (answer) {
      this.contextGauge = toContextGauge(answer)
      this.changed()
    }
    const account = this.processAccount
    if (!force && !this.env.planLimitsDue(account)) return
    const usage = await readUsage(session.query).catch(() => undefined)
    // A token account answers without limits: the windows seen in rate_limit_events stay.
    if (usage) this.env.setPlanLimits(account, toPlanLimits(toUsage(usage)) ?? this.env.planLimits(account))
  }

  // Answers an open request. by: the answering client. A mode set by the answer becomes the tab's mode.
  answer(requestId: string, answer: Answer, by: string): void {
    const mode = modeSetBy(this.requests.answer(requestId, answer, by))
    if (mode) this.adoptMode(mode)
  }

  history(beforeItemId: string, limit: number): { items: Item[]; hasMore: boolean } {
    return this.transcript.history(beforeItemId, limit)
  }

  // Renames the tab and its session: the live process (its name for the other sessions and its stored title), or the
  // stored session when none runs.
  async rename(title: string): Promise<void> {
    this.title = title
    this.autoTitle = false
    this.changed()
    if (this.session) await this.nameSession(title, 'host')
    else if (this.sessionId) await this.env.sdk.renameSession(this.sessionId, title, { dir: this.cwd })
  }

  // Gives the live session a title: the CLI stores it and takes it as its name for the other sessions. source: 'host'
  // a name the user gave (a refusal reaches them), 'remote' the title the tab took from the CLI (a refusal is
  // ignored: the session keeps its name until its next start, which gets the title). The SDK 0.3.287 types do not
  // have the request: it goes through the Query's control request.
  private async nameSession(title: string, source: 'host' | 'remote'): Promise<void> {
    const query = this.session?.query as unknown as { request(request: object): Promise<unknown> } | undefined
    await query?.request({ subtype: 'rename_session', title, source }).catch((error: unknown) => {
      if (source === 'host') this.sdkFailure('Session rename failed', error)
    })
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
      this.stopCountdown()
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
      this.transcript.rebuildFrom(() => this.cutAtResume(messages).forEach((message) => this.normalizer.history(message)))
    })
    return this.historyPromise
  }

  // The stored messages up to and including the rewind's resume point (all of them when none is set or it is not found).
  private cutAtResume(messages: SessionMessage[]): SessionMessage[] {
    const end = this.resumeAt ? messages.findIndex((message) => message.uuid === this.resumeAt) : -1
    return end < 0 ? messages : messages.slice(0, end + 1)
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
      const account = this.account
      const token = await this.env.accountToken(account)
      this.processAccount = account
      const session = new Session(this.env.sdk.query, this.sessionOptions(token), {
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

  // token: the account's token (CLAUDE_CODE_OAUTH_TOKEN of the process); absent: Claude Code's own login.
  private sessionOptions(token?: string): Options {
    const autoCompactWindow = this.env.autoCompactWindow()
    return {
      ...BASE_OPTIONS,
      ...this.env.sdkOptions,
      // The session's name for the other sessions (ListAgents, SendMessage) is the tab's title.
      env: { ...(this.env.sdkOptions.env ?? process.env), CLAUDE_CODE_SESSION_NAME: this.title, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) },
      cwd: this.cwd,
      resume: this.sessionId,
      ...(this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
      model: this.model,
      effort: this.effort,
      ...(autoCompactWindow ? { settings: { autoCompactWindow } } : {}),
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
    if (!this.queueFree()) return this.stopCountdown()
    const first = this.queue[0]!
    if (this.countdown?.queueId === first.queueId) return
    this.stopCountdown()
    if (!this.env.watched(this.tabId)) return this.sendFirstQueued()
    // The chat is on screen: the message waits a countdown in its composer, where it can be stopped.
    const timer = setTimeout(() => {
      this.countdown = undefined
      if (this.queueFree() && this.queue[0]?.queueId === first.queueId) this.sendFirstQueued()
      else this.dispatchNext()
    }, this.env.queueCountdownMs)
    timer.unref?.()
    this.countdown = { queueId: first.queueId, until: Date.now() + this.env.queueCountdownMs, timer }
    this.changed()
  }

  // The queue may send now: Claude is free, the queue is not paused and not empty.
  private queueFree(): boolean {
    const free = !this.rewinding && !this.turnRunning && !this.held.size && !this.requests.size && this.lifecycle !== 'closing' && this.lifecycle !== 'starting'
    return free && !this.queuePause && this.queue.length > 0
  }

  private stopCountdown(): void {
    if (!this.countdown) return
    clearTimeout(this.countdown.timer)
    this.countdown = undefined
  }

  // Sends the first queued message (back at the head of the queue if it cannot go).
  private sendFirstQueued(): void {
    const next = this.queue.shift()!
    this.changed()
    this.deliver(next).catch((error: unknown) => {
      this.queue.unshift(next)
      this.changed()
      if (!(error instanceof CoreError && error.code === 'needs_trust')) this.notice('error', `The queued message could not be sent: ${messageOf(error)}`)
    })
  }

  // A turn the CLI started for a message core did not send: one from another session shows in the chat with its
  // sender, before the answer. Its live messages wait (INCOMING_WAIT_MS at most) while the message is read from the
  // stored session; the stored message's uuid is the command's.
  private lookUpIncoming(uuid: string): void {
    this.incoming = uuid
    const batch: SDKMessage[] = (this.waitingMessages = [])
    const timer = setTimeout(() => this.releaseWaiting(batch), INCOMING_WAIT_MS)
    void this.findIncoming(uuid)
      .then((peer) => this.showPeer(uuid, peer))
      .catch((error: unknown) => this.notice('warning', `Internal error while reading a message from another session: ${messageOf(error)}`))
      .finally(() => (clearTimeout(timer), this.releaseWaiting(batch)))
  }

  // The message from another session that started turn uuid, read from the stored session (again while the CLI has
  // not written it yet); undefined when the message is not one, has no text, or is not found in time.
  private async findIncoming(uuid: string): Promise<{ from: string; text: string } | undefined> {
    for (const pause of INCOMING_RETRIES_MS) {
      if (pause) await sleep(pause)
      if (this.incoming !== uuid || !this.sessionId) return undefined
      const messages = await this.env.sdk.getSessionMessages(this.sessionId, { dir: this.cwd }).catch(() => [])
      const stored = messages.find((message) => message.uuid === uuid)
      if (stored) return storedPeer(stored)
    }
    return undefined
  }

  // Lets the live messages held for a lookup go on, in order (unless a newer lookup holds them now). A result among
  // them that names a message from another session shows it first, if the stored session did not have it.
  private releaseWaiting(batch: SDKMessage[]): void {
    if (this.waitingMessages !== batch) return
    this.waitingMessages = undefined
    const result = batch.find((message): message is SDKResultMessage => message.type === 'result')
    if (result && this.incoming) this.showPeer(this.incoming, peerOf(result.origin, ''))
    for (const message of batch) {
      try {
        this.onMessage(message)
      } catch (error) {
        this.notice('warning', `Internal error while reading the session: ${messageOf(error)}`)
      }
    }
  }

  // The process is ending: what it sent while a lookup held its messages goes on, and no turn of its is incoming.
  private endIncoming(): void {
    if (this.waitingMessages) this.releaseWaiting(this.waitingMessages)
    this.incoming = undefined
  }

  // Adds a message from another session to the chat (once).
  private showPeer(uuid: string, peer: { from: string; text: string } | undefined): void {
    if (peer && !this.transcript.get(uuid)) this.transcript.add({ kind: 'peerMessage', itemId: uuid, sourceUuid: uuid, ...peer })
  }

  // The end of a turn another session's message started also names it (origin): shown then, before the end of the
  // turn, if the stored session did not have it.
  private peerFromResult(result: SDKResultMessage): void {
    const uuid = this.incoming
    this.incoming = undefined
    if (uuid) this.showPeer(uuid, peerOf(result.origin, ''))
  }

  // Applies one SDK message: transcript items via the normalizer, metadata here. The empty results of
  // transcript-only messages are dropped (they end no turn; the probe checks the CLI still sends them).
  private onMessage(message: SDKMessage): void {
    if (this.waitingMessages) return void this.waitingMessages.push(message)
    if (isCommandLifecycle(message)) return this.onCommandLifecycle(message)
    if (message.type === 'result' && this.silentResults > 0 && message.num_turns === 0) return void this.silentResults--
    if (message.type === 'result') this.peerFromResult(message)
    this.normalizer.live(message)
    if (message.type === 'system' && message.subtype === 'init') {
      this.setSessionId(message.session_id)
      // The new process runs on the cut conversation: its own records continue from there.
      this.resumeAt = undefined
      this.activeModel = message.model
      this.adoptMode(message.permissionMode, true)
    } else if (message.type === 'system' && message.subtype === 'status' && message.permissionMode) {
      this.adoptMode(message.permissionMode, true)
    } else if (message.type === 'system' && message.subtype === 'commands_changed') {
      this.cachedCommands = visibleCommands(message.commands)
    } else if (message.type === 'conversation_reset') {
      this.resetConversation(message.new_conversation_id)
    } else if (message.type === 'rate_limit_event') {
      const windows = planLimitsFromEvent(message.rate_limit_info)
      if (windows) this.env.mergePlanLimits(this.processAccount, windows)
      if (message.rate_limit_info.status === 'rejected' && message.rate_limit_info.resetsAt) {
        if (this.turnRunning) this.interrupted = 'limit'
        this.turnRejected = true
        this.env.rateLimited(message.rate_limit_info.resetsAt * 1000, this.processAccount)
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success' && !message.is_error && !this.turnRejected) this.env.limitLifted(this.processAccount)
      this.turnRejected = false
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
    if (!item) this.lookUpIncoming(uuid)
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
    void this.refreshGauges()
    // An account switch asked during the turn: the process goes first, the queue then starts a new one.
    if (this.switchPending) void this.releaseProcess().then(() => this.dispatchNext())
    else this.dispatchNext()
    this.changed()
    void this.followCliTitle()
  }

  // The session's own title (see tabTitle), while the tab has no title given by the user: after each turn, and right
  // after a stored session is opened. A live session is given it too, so its name for the other sessions follows.
  async followCliTitle(): Promise<void> {
    if (!this.autoTitle || !this.sessionId) return
    const info = await this.env.sdk.getSessionInfo(this.sessionId, { dir: this.cwd }).catch(() => undefined)
    const title = tabTitle(info)
    if (!title || title === this.title || !this.autoTitle) return
    this.title = title
    this.changed()
    await this.nameSession(title, 'remote')
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
    this.endIncoming()
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

  private assertNotRewinding(): void {
    if (this.rewinding) throw new CoreError('session_busy', 'a rewind is in progress')
  }

  private assertOpen(): void {
    if (this.lifecycle === 'closing') throw new CoreError('not_found', 'tab is closing')
  }

  // Something of the tab changed: tell the workspace. An empty queue is never paused, except by a usage limit (which
  // also holds the next message typed into the queue until the reset).
  // Marks the tab as used now (the open-sessions lists show the last used first); the caller announces the change.
  private used(): void {
    this.lastUsedAt = Date.now()
  }

  // Follows the status for the work time: it runs while Claude works, stops (keeping the time worked) while a request
  // waits for an answer, and goes back to zero once the turn is over.
  private updateWorkClock(): void {
    const status = this.status
    if (status === 'running') this.workingSince ??= Date.now() - this.workedMs
    else if (status === 'requires_action') {
      if (this.workingSince !== undefined) this.workedMs = Date.now() - this.workingSince
      this.workingSince = undefined
    } else {
      this.workingSince = undefined
      this.workedMs = 0
    }
  }

  private changed(): void {
    this.updateWorkClock()
    if (!this.queue.length && this.queuePause && this.queuePause.reason !== 'limit') this.queuePause = undefined
    // A countdown ends when its message is no longer next, the queue waits, or Claude started working.
    if (this.countdown && (this.queue[0]?.queueId !== this.countdown.queueId || this.queuePause || this.turnRunning)) this.stopCountdown()
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

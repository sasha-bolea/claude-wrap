import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import * as claudeSdk from '@anthropic-ai/claude-agent-sdk'
import { WORKSPACE_STREAM, tabStream, type Effort, type Home, type PermissionMode, type PlanLimits } from '@claude-wrap/protocol'
import { AccountStore } from './accounts.ts'
import { ActivityFile } from './activity.ts'
import type { CoreConfig, Notice, SdkApi } from './config.ts'
import { CoreError } from './errors.ts'
import { NoteStore } from './notes.ts'
import { waitForCleanups } from './process.ts'
import { PromptHistory } from './promptHistory.ts'
import type { PersistedState, StateStore } from './state.ts'
import { DEFAULT_RING, Stream } from './stream.ts'
import { MAX_AUTO_TITLE, Tab, type TabEnvironment, type TabInit } from './tab.ts'
import { Terminals } from './terminals.ts'
import { Trash } from './trash.ts'
import { TrustGate, canonicalFolder, checkRoots, withinRoots } from './trustGate.ts'

// Upper bound for closing everything on quit.
const QUIT_CAP_MS = 8000
// How often the terminals are looked at for a running command (activity file).
const ACTIVITY_POLL_MS = 2000

// The title of a saved tab when it comes back. Older states have no autoTitle: the folder's name meant automatic. A
// title longer than a title is a prompt the CLI fell back to (fixed by older versions when a stored session was
// opened): back to the folder's name, following the CLI again.
function restoredTitle(saved: PersistedState['tabs'][number]): { title: string; autoTitle: boolean } {
  if (saved.title.length > MAX_AUTO_TITLE) return { title: basename(saved.cwd) || saved.cwd, autoTitle: true }
  return { title: saved.title, autoTitle: saved.autoTitle ?? saved.title === basename(saved.cwd) }
}
// The plan windows of an account are read again at the end of a turn at most this often (ms).
const PLAN_READ_MS = 60_000
const DAY_MS = 24 * 3600 * 1000

// All tabs of the backend (in order), the session index over them (dormant included), the workspace stream,
// the trust gate, the Home (folders, project marks), trash, notes, and their persistence.
export class Workspace {
  readonly tabs = new Map<string, Tab>()
  // Chats that finished (or stopped with an error) while nobody looked at them, for the notification count.
  private readonly finished = new Set<string>()
  readonly stream: Stream
  readonly trust: TrustGate
  readonly sdk: SdkApi
  readonly prompts: PromptHistory
  readonly notes: NoteStore
  readonly accounts: AccountStore
  readonly terminals: Terminals
  readonly allowedRoots: 'any' | string[]
  // The app's trash (remote server); the desktop moves things to the system trash instead.
  readonly trash?: Trash
  private readonly trashItem?: (path: string) => Promise<void>
  private readonly sessionIndex = new Map<string, string>() // sessionId → tabId
  private readonly store: StateStore
  private readonly env: TabEnvironment
  private readonly activity?: ActivityFile
  private readonly activityTimer?: NodeJS.Timeout
  private readonly trashTimer?: NodeJS.Timeout
  // Plan windows per account ('' = the login) for the composer gauges, and when they were read.
  private readonly plans = new Map<string, { limits?: PlanLimits; readAt: number }>()
  // Usage limits per account ('' = Claude Code's own login): until when, and the timer that ends them.
  private readonly limits = new Map<string, { until: number; timer: NodeJS.Timeout }>()
  private savedTabs = ''

  // config: core configuration; store: the loaded state (tabs come back dormant).
  constructor(config: CoreConfig, store: StateStore) {
    this.store = store
    for (const [account, plan] of Object.entries(store.data.planLimits ?? {})) this.plans.set(account, plan)
    this.sdk = { ...claudeSdk, ...config.sdk }
    this.trust = new TrustGate(store)
    this.allowedRoots = config.allowedRoots ?? 'any'
    const claudeDir = config.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    this.prompts = new PromptHistory(config.stateDir && join(config.stateDir, 'history.jsonl'), join(claudeDir, 'history.jsonl'))
    this.notes = new NoteStore(config.stateDir && join(config.stateDir, 'notes.json'))
    this.stream = new Stream(
      WORKSPACE_STREAM,
      () => ({
        kind: 'workspace',
        tabs: [...this.tabs.values()].map((tab) => tab.meta()),
        home: this.home(),
        projects: this.projects(),
        accounts: this.accounts.list(),
        defaultAccount: this.accounts.defaultAccount,
        autoCompactWindow: this.store.data.autoCompactWindow,
        defaultEffort: this.store.data.defaultEffort,
        defaultMode: this.store.data.defaultMode,
        terminals: this.terminals.list()
      }),
      config.ring ?? DEFAULT_RING
    )
    this.accounts = new AccountStore(config.stateDir && join(config.stateDir, 'accounts.json'), () =>
      this.stream.emit({ type: 'accounts.updated', accounts: this.accounts.list(), defaultAccount: this.accounts.defaultAccount })
    )
    this.terminals = new Terminals((ev) => this.stream.emit(ev), config.terminalShell)
    this.env = this.environment(config)
    // A tab where nothing was ever sent (no stored session, nothing queued) does not come back.
    for (const saved of store.data.tabs.filter((tab) => tab.sessionId || tab.queue?.length))
      this.add(new Tab({ ...saved, ...restoredTitle(saved), resume: saved.sessionId }, this.env))
    this.savedTabs = JSON.stringify(store.data.tabs)
    // Restored tabs are dormant: 0 overwrites what a previous run may have left.
    this.activity = config.activityFile ? new ActivityFile(config.activityFile) : undefined
    this.activity?.set(0)
    // A command in a terminal starts and ends without any event: it is looked at regularly.
    if (this.activity) this.activityTimer = setInterval(() => this.countActivity(), config.activityPollMs ?? ACTIVITY_POLL_MS).unref()
    // The first start with a Home on this PC: it begins with the folders of the open sessions.
    if (this.allowedRoots === 'any' && !store.data.addedFolders) {
      const folders = [...new Set(store.data.tabs.map((tab) => tab.cwd))]
      store.update((data) => (data.addedFolders = folders)).catch(() => undefined)
    }
    this.trashItem = config.trashItem
    if (!config.trashItem && config.stateDir) {
      const trash = new Trash(join(config.stateDir, 'trash'))
      this.trash = trash
      void trash.expire()
      this.trashTimer = setInterval(() => void trash.expire(), DAY_MS).unref()
    }
    // Usage limits still running from before the restart (per account).
    for (const tab of store.data.tabs) if (tab.queuePause?.reason === 'limit' && tab.queuePause.until) this.rateLimited(Math.max(tab.queuePause.until, this.limitedUntil(tab.account) ?? 0), tab.account)
  }

  // The Home of this backend: the root sessions live under (remote server) or the folders added on this PC.
  home(): Home {
    return this.allowedRoots === 'any' ? { kind: 'added', folders: this.store.data.addedFolders ?? [] } : { kind: 'root', path: this.allowedRoots[0]! }
  }

  // Folders marked as projects.
  projects(): string[] {
    return [...this.store.data.projects]
  }

  // The tab or not_found.
  tabOf(tabId: string): Tab {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new CoreError('not_found', `tab ${tabId} not found`)
    return tab
  }

  // The tab behind a `tab:<id>` stream name, if it exists.
  tabOfStream(stream: string): Tab | undefined {
    return [...this.tabs.values()].find((tab) => tabStream(tab.tabId) === stream)
  }

  // The tab that has a session open, dormant included.
  tabOfSession(sessionId: string): Tab | undefined {
    return this.tabs.get(this.sessionIndex.get(sessionId) ?? '')
  }

  // Creates a tab. A duplicate tabId, or a session another tab already owns, returns that tab's id.
  create(init: TabInit): string {
    const existing = this.tabs.get(init.tabId) ?? (init.resume ? this.tabOfSession(init.resume) : undefined)
    if (existing) return existing.tabId
    const tab = new Tab({ ...init, account: init.account ?? this.accounts.defaultAccount }, this.env)
    this.add(tab)
    this.stream.emit({ type: 'tab.added', tab: tab.meta() })
    this.persist()
    // A stored session opened without a title takes the CLI's own title now (it follows it afterwards).
    if (init.resume && !init.title) void tab.followCliTitle()
    return init.tabId
  }

  // Work in progress for the automatic update: sessions starting, running or waiting for an answer, and terminals
  // running a command.
  private countActivity(): void {
    this.activity?.set([...this.tabs.values()].filter((tab) => tab.busy).length + this.terminals.busyCount())
  }

  // Someone looks at the chat of a tab: it no longer counts as finished in the notification.
  seen(tabId: string): void {
    this.finished.delete(tabId)
  }

  // Closes a tab (its queue is discarded); the session lock is released only once its process has exited.
  async close(tabId: string): Promise<void> {
    const tab = this.tabOf(tabId)
    await tab.close()
    this.tabs.delete(tabId)
    this.finished.delete(tabId)
    if (tab.sessionId && this.sessionIndex.get(tab.sessionId) === tabId) this.sessionIndex.delete(tab.sessionId)
    this.stream.emit({ type: 'tab.removed', tabId })
    this.persist()
  }

  // Moves a tab to a new position (clamped to the end).
  reorder(tabId: string, index: number): void {
    const tab = this.tabOf(tabId)
    const order = [...this.tabs.values()].filter((other) => other !== tab)
    const position = Math.min(index, order.length)
    order.splice(position, 0, tab)
    this.tabs.clear()
    for (const entry of order) this.tabs.set(entry.tabId, entry)
    this.stream.emit({ type: 'tab.moved', tabId, index: position })
    this.persist()
  }

  // Accepts a folder's trust; tabs waiting for it may start again.
  async grantTrust(cwd: string): Promise<void> {
    await this.trust.grant(cwd)
    for (const tab of this.tabs.values()) tab.trustChanged()
  }

  // A folder from a client, canonical and inside the roots (not_found / outside_root otherwise).
  async folderOf(path: string): Promise<string> {
    const folder = await canonicalFolder(path)
    checkRoots(folder, this.allowedRoots)
    return folder
  }

  // Marks or unmarks a folder (any level) as a project, for every device.
  async setProject(path: string, project: boolean): Promise<void> {
    const folder = await this.folderOf(path)
    await this.updateFolders((data) => (data.projects = project ? [...new Set([...data.projects, folder])] : data.projects.filter((other) => other !== folder)))
  }

  // Adds a folder to the Home of this PC (only where any folder is allowed). Returns its canonical path.
  async addFolder(path: string): Promise<string> {
    if (this.allowedRoots !== 'any') throw new CoreError('invalid_args', 'the Home of this backend is its root folder')
    const folder = await canonicalFolder(path)
    await this.updateFolders((data) => (data.addedFolders = [...new Set([...(data.addedFolders ?? []), folder])]))
    return folder
  }

  // Takes a folder off the Home of this PC; its files stay.
  async removeFolder(path: string): Promise<void> {
    await this.updateFolders((data) => (data.addedFolders = (data.addedFolders ?? []).filter((folder) => folder !== path)))
  }

  // Deletes a folder strictly inside the Home (never one of the Home's own folders). A session open in it refuses the
  // delete, unless closeSessions: those sessions are closed first.
  async deleteFolder(path: string, closeSessions = false): Promise<void> {
    const folder = await this.folderOf(path)
    const bases = this.allowedRoots === 'any' ? (this.store.data.addedFolders ?? []) : this.allowedRoots
    if (!bases.some((base) => base !== folder && withinRoots(folder, [base]))) throw new CoreError('invalid_args', 'only folders inside the Home can be deleted')
    const inside = [...this.tabs.values()].filter((tab) => withinRoots(tab.cwd, [folder]))
    if (inside.length && !closeSessions) throw new CoreError('session_busy', 'close the sessions open in this folder first')
    for (const tab of inside) await this.close(tab.tabId)
    await this.discard(folder)
  }

  // Moves a file or folder out of the way: to the system trash (desktop) or to the app's trash, with the project marks
  // it held (they come back with a restore).
  async discard(path: string): Promise<void> {
    const marks = this.store.data.projects.filter((project) => withinRoots(project, [path]))
    if (this.trashItem) await this.trashItem(path)
    else if (this.trash) await this.trash.put(path, marks.map((project) => relative(path, project)))
    else throw new CoreError('invalid_args', 'no trash on this backend')
    if (marks.length) await this.updateFolders((data) => (data.projects = data.projects.filter((project) => !marks.includes(project))))
  }

  // Puts a trashed item back, with its project marks. Returns where it went.
  async restore(id: string): Promise<string> {
    if (!this.trash) throw new CoreError('not_found', 'no app trash on this backend')
    const entry = await this.trash.restore(id)
    if (entry.projects.length) await this.updateFolders((data) => (data.projects = [...new Set([...data.projects, ...entry.projects.map((mark) => join(entry.path, mark))])]))
    return entry.path
  }

  // A usage limit of an account (undefined = Claude Code's own login) was hit: the queues of its sessions wait until
  // `until` (ms), then go on by themselves, except where the limit stopped Claude mid-work (those wait for
  // "Continua"); its sessions show until when.
  rateLimited(until: number, account: string | undefined): void {
    const key = account ?? ''
    clearTimeout(this.limits.get(key)?.timer)
    const timer = setTimeout(() => {
      this.limits.delete(key)
      for (const tab of this.tabsOf(account)) {
        if (!tab.interruptedBy) tab.resumeQueue('limit')
        this.env.changed(tab)
      }
    }, Math.max(0, until - Date.now()))
    timer.unref()
    this.limits.set(key, { until, timer })
    for (const tab of this.tabsOf(account)) (tab.pauseQueue({ reason: 'limit', until }), this.env.changed(tab))
  }

  // A turn of an account went through: a usage limit still recorded for it is over now (its queues go on, except
  // where Claude was stopped mid-work, which waits for "Continua").
  limitLifted(account: string | undefined): void {
    const key = account ?? ''
    const limit = this.limits.get(key)
    if (!limit) return
    clearTimeout(limit.timer)
    this.limits.delete(key)
    for (const tab of this.tabsOf(account)) {
      if (!tab.interruptedBy) tab.resumeQueue('limit')
      this.env.changed(tab)
    }
  }

  // When the usage limit of an account ends, while it lasts.
  limitedUntil(account: string | undefined): number | undefined {
    const limit = this.limits.get(account ?? '')
    return limit && limit.until > Date.now() ? limit.until : undefined
  }

  // Claude Code's auto-compact window for every session (undefined: Claude Code's own setting): saved, announced,
  // and taken by every process at its next start (live ones restart, at the end of a running turn).
  async setAutoCompactWindow(tokens: number | undefined): Promise<void> {
    await this.store.update((data) => (data.autoCompactWindow = tokens))
    this.announceSettings()
    await Promise.all([...this.tabs.values()].map((tab) => tab.applyAutoCompactWindow()))
  }

  // The effort of the sessions created from now on (undefined: the model's): saved and announced.
  async setDefaultEffort(effort: Effort | undefined): Promise<void> {
    await this.store.update((data) => (data.defaultEffort = effort))
    this.announceSettings()
  }

  // The permission mode of the sessions created from now on (undefined: 'default'): saved and announced.
  async setDefaultMode(mode: PermissionMode | undefined): Promise<void> {
    await this.store.update((data) => (data.defaultMode = mode))
    this.announceSettings()
  }

  // A new session's init with the default effort and mode filled in where the client gave none.
  withDefaults(init: TabInit): TabInit {
    const { defaultEffort, defaultMode } = this.store.data
    return { ...init, effort: init.effort ?? defaultEffort, mode: init.mode ?? defaultMode }
  }

  // Tells the clients every backend setting as it now is.
  private announceSettings(): void {
    const { autoCompactWindow, defaultEffort, defaultMode } = this.store.data
    this.stream.emit({ type: 'settings.updated', autoCompactWindow, defaultEffort, defaultMode })
  }

  // The plan windows of an account as last read (composer gauges).
  planLimits(account: string | undefined): PlanLimits | undefined {
    return this.plans.get(account ?? '')?.limits
  }

  // A new read of an account's plan windows is due (at most one a minute, at the end of turns).
  planLimitsDue(account: string | undefined): boolean {
    return Date.now() - (this.plans.get(account ?? '')?.readAt ?? 0) >= PLAN_READ_MS
  }

  // Stores an account's plan windows: every session of that account shows them.
  setPlanLimits(account: string | undefined, limits: PlanLimits | undefined): void {
    this.plans.set(account ?? '', { limits, readAt: Date.now() })
    void this.store.update((data) => (data.planLimits = Object.fromEntries(this.plans))).catch(() => undefined)
    for (const tab of this.tabsOf(account)) this.env.changed(tab)
  }

  // Plan windows seen in a rate_limit_event (also for token accounts): merged over the last read, window by window,
  // without moving the time of the last /usage read.
  mergePlanLimits(account: string | undefined, limits: PlanLimits): void {
    const plan = this.plans.get(account ?? '')
    this.plans.set(account ?? '', { limits: { ...plan?.limits, ...limits }, readAt: plan?.readAt ?? 0 })
    void this.store.update((data) => (data.planLimits = Object.fromEntries(this.plans))).catch(() => undefined)
    for (const tab of this.tabsOf(account)) this.env.changed(tab)
  }

  // The gauge sheet of a tab opened: its gauges are read again from its live process, or (dormant) the plan windows
  // through a live session of the same account. No process is started.
  async refreshGauges(tabId: string): Promise<void> {
    const tab = this.tabOf(tabId)
    if (tab.live) return tab.refreshGauges(true)
    await this.tabsOf(tab.accountId).find((other) => other.live)?.refreshGauges(true)
  }

  // The Claude account of every session and of the new ones (undefined = Claude Code's own login).
  async useAccount(accountId: string | undefined): Promise<void> {
    await this.accounts.setDefault(accountId)
    await Promise.all([...this.tabs.values()].map((tab) => tab.setAccount(accountId)))
  }

  // "Continua": the sessions stopped by a usage limit or an account switch, whose account is free now, get text as a
  // message of from (without text the marks are only cleared).
  async continueStopped(text: string | undefined, from: string): Promise<void> {
    const stopped = [...this.tabs.values()].filter((tab) => tab.interruptedBy && !this.limitedUntil(tab.accountId))
    await Promise.all(stopped.map((tab) => tab.resume(text, from)))
  }

  // Removes an account: its sessions go back to Claude Code's own login.
  async removeAccount(accountId: string): Promise<void> {
    await this.accounts.remove(accountId)
    for (const tab of this.tabsOf(accountId)) await tab.setAccount(undefined)
  }

  private tabsOf(account: string | undefined): Tab[] {
    return [...this.tabs.values()].filter((tab) => tab.accountId === account)
  }

  // Closes every tab (quit), keeping their queues. Resolves when processes and orphan cleanups are done, at most
  // after QUIT_CAP_MS.
  async closeAll(): Promise<void> {
    clearInterval(this.trashTimer)
    clearInterval(this.activityTimer)
    this.terminals.closeAll()
    for (const { timer } of this.limits.values()) clearTimeout(timer)
    const closing = Promise.all([...this.tabs.values()].map((tab) => tab.close(true))).then(waitForCleanups)
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, QUIT_CAP_MS).unref())])
    await this.store.flush()
  }

  private add(tab: Tab): void {
    this.tabs.set(tab.tabId, tab)
    if (tab.sessionId) this.sessionIndex.set(tab.sessionId, tab.tabId)
  }

  // Applies a change to the Home or the project marks, saves it and tells every client.
  private async updateFolders(change: (data: PersistedState) => void): Promise<void> {
    await this.store.update(change)
    this.stream.emit({ type: 'folders.updated', home: this.home(), projects: this.projects() })
  }

  // Saves the tabs when what survives a restart changed (not on every status change).
  private persist(): void {
    const tabs = [...this.tabs.values()].map((tab) => tab.persisted())
    const serialized = JSON.stringify(tabs)
    if (serialized === this.savedTabs) return
    this.savedTabs = serialized
    // Best effort: a failed write is repaired by the next one (each save writes the whole state).
    this.store.update((data) => (data.tabs = tabs)).catch(() => undefined)
  }

  // Records a live claude process, or forgets an exited one (startup sweep after a core crash).
  private trackProcess(pid: number, startedAt?: number): void {
    this.store
      .update((data) => {
        data.livePids = data.livePids.filter((entry) => entry.pid !== pid)
        if (startedAt !== undefined) data.livePids.push({ pid, startedAt })
      })
      .catch(() => undefined)
  }

  // Tells the host about an event, with the chats now waiting for an answer and the ones finished while nobody looked.
  // tab, kind, detail: the event; config: where the notifier is.
  private notify(tab: Tab, kind: Notice['kind'], detail: string | undefined, config: CoreConfig): void {
    if (kind !== 'request' && !(config.watching?.(tab.tabId) ?? false)) this.finished.add(tab.tabId)
    const waiting = [...this.tabs.values()].filter((other) => other.meta().pendingRequests > 0 || (other === tab && kind === 'request'))
    for (const other of waiting) this.finished.delete(other.tabId)
    config.notifier?.({ kind, tabId: tab.tabId, title: tab.title, detail, waiting: waiting.length, finished: this.finished.size })
  }

  // What tabs need from their surroundings: SDK, options, limits, and the callbacks that feed the workspace.
  private environment(config: CoreConfig): TabEnvironment {
    const maxLiveSessions = config.maxLiveSessions ?? 8
    return {
      sdk: this.sdk,
      sdkOptions: config.sdkOptions ?? {},
      transcript: { coalesceMs: config.coalesceMs ?? 16, snapshotItems: config.snapshotItems ?? 200, ring: config.ring ?? DEFAULT_RING },
      closeTimeoutMs: config.closeTimeoutMs ?? 3000,
      queueCountdownMs: config.queueCountdownMs ?? 10_000,
      watched: (tabId) => config.watching?.(tabId) ?? false,
      checkCanStart: () => {
        const live = [...this.tabs.values()].filter((tab) => tab.holdsProcess).length
        if (live >= maxLiveSessions) throw new CoreError('limit_reached', `at most ${maxLiveSessions} live sessions`)
      },
      prepareStart: async (cwd) => {
        const folder = await this.folderOf(cwd)
        if (!(await this.trust.isTrusted(folder))) throw new CoreError('needs_trust', `folder not trusted: ${folder}`)
        return folder
      },
      changed: (tab) => {
        if (tab.busy) this.finished.delete(tab.tabId)
        this.countActivity()
        if (this.tabs.get(tab.tabId) !== tab) return
        this.stream.emit({ type: 'tab.updated', tab: tab.meta() })
        this.persist()
      },
      turnFinished: (tab) => this.stream.emit({ type: 'turn.finished', tabId: tab.tabId }),
      sessionIdChanged: (tab, previous) => {
        if (previous && this.sessionIndex.get(previous) === tab.tabId) this.sessionIndex.delete(previous)
        if (tab.sessionId) this.sessionIndex.set(tab.sessionId, tab.tabId)
      },
      promptSent: (tab, text) => this.prompts.add(text, tab.cwd, tab.sessionId),
      notify: (tab, kind, detail) => this.notify(tab, kind, detail, config),
      rateLimited: (until, account) => this.rateLimited(until, account),
      limitLifted: (account) => this.limitLifted(account),
      limitedUntil: (account) => this.limitedUntil(account),
      planLimits: (account) => this.planLimits(account),
      mergePlanLimits: (account, limits) => this.mergePlanLimits(account, limits),
      autoCompactWindow: () => this.store.data.autoCompactWindow,
      planLimitsDue: (account) => this.planLimitsDue(account),
      setPlanLimits: (account, limits) => this.setPlanLimits(account, limits),
      accountToken: (account) => this.accounts.token(account),
      processStarted: (pid, startedAt) => this.trackProcess(pid, startedAt),
      processExited: (pid) => this.trackProcess(pid)
    }
  }
}

import { homedir } from 'node:os'
import { join } from 'node:path'
import * as claudeSdk from '@anthropic-ai/claude-agent-sdk'
import { WORKSPACE_STREAM, tabStream } from '@claude-wrap/protocol'
import type { CoreConfig, SdkApi } from './config.ts'
import { CoreError } from './errors.ts'
import { waitForCleanups } from './process.ts'
import { PromptHistory } from './promptHistory.ts'
import type { StateStore } from './state.ts'
import { DEFAULT_RING, Stream } from './stream.ts'
import { Tab, type TabEnvironment, type TabInit } from './tab.ts'
import { TrustGate, canonicalFolder, checkRoots } from './trustGate.ts'

// Upper bound for closing everything on quit.
const QUIT_CAP_MS = 8000

// All tabs of the backend (in order), the session index over them (dormant included), the workspace stream,
// the trust gate, and their persistence in state.json.
export class Workspace {
  readonly tabs = new Map<string, Tab>()
  readonly stream: Stream
  readonly trust: TrustGate
  readonly sdk: SdkApi
  readonly prompts: PromptHistory
  readonly allowedRoots: 'any' | string[]
  private readonly sessionIndex = new Map<string, string>() // sessionId → tabId
  private readonly store: StateStore
  private readonly env: TabEnvironment
  private savedTabs = ''

  // config: core configuration; store: the loaded state (tabs come back dormant).
  constructor(config: CoreConfig, store: StateStore) {
    this.store = store
    this.sdk = { ...claudeSdk, ...config.sdk }
    this.trust = new TrustGate(store)
    this.allowedRoots = config.allowedRoots ?? 'any'
    const claudeDir = config.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    this.prompts = new PromptHistory(config.stateDir && join(config.stateDir, 'history.jsonl'), join(claudeDir, 'history.jsonl'))
    this.stream = new Stream(WORKSPACE_STREAM, () => ({ kind: 'workspace', tabs: [...this.tabs.values()].map((tab) => tab.meta()) }), config.ring ?? DEFAULT_RING)
    this.env = this.environment(config)
    for (const saved of store.data.tabs) this.add(new Tab({ ...saved, resume: saved.sessionId }, this.env))
    this.savedTabs = JSON.stringify(store.data.tabs)
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
    const tab = new Tab(init, this.env)
    this.add(tab)
    this.stream.emit({ type: 'tab.added', tab: tab.meta() })
    this.persist()
    return init.tabId
  }

  // Closes a tab; the session lock is released only once its process has exited.
  async close(tabId: string): Promise<void> {
    const tab = this.tabOf(tabId)
    await tab.close()
    this.tabs.delete(tabId)
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

  // Closes every tab (quit). Resolves when processes and orphan cleanups are done, at most after QUIT_CAP_MS.
  async closeAll(): Promise<void> {
    const closing = Promise.all([...this.tabs.values()].map((tab) => tab.close())).then(waitForCleanups)
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, QUIT_CAP_MS).unref())])
    await this.store.flush()
  }

  private add(tab: Tab): void {
    this.tabs.set(tab.tabId, tab)
    if (tab.sessionId) this.sessionIndex.set(tab.sessionId, tab.tabId)
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

  // What tabs need from their surroundings: SDK, options, limits, and the callbacks that feed the workspace.
  private environment(config: CoreConfig): TabEnvironment {
    const maxLiveSessions = config.maxLiveSessions ?? 8
    return {
      sdk: this.sdk,
      sdkOptions: config.sdkOptions ?? {},
      transcript: { coalesceMs: config.coalesceMs ?? 16, snapshotItems: config.snapshotItems ?? 200, ring: config.ring ?? DEFAULT_RING },
      closeTimeoutMs: config.closeTimeoutMs ?? 3000,
      checkCanStart: () => {
        const live = [...this.tabs.values()].filter((tab) => tab.holdsProcess).length
        if (live >= maxLiveSessions) throw new CoreError('limit_reached', `at most ${maxLiveSessions} live sessions`)
      },
      prepareStart: async (cwd) => {
        const folder = await canonicalFolder(cwd)
        checkRoots(folder, this.allowedRoots)
        if (!(await this.trust.isTrusted(folder))) throw new CoreError('needs_trust', `folder not trusted: ${folder}`)
        return folder
      },
      changed: (tab) => {
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
      notify: (tab, kind, detail) => config.notifier?.({ kind, tabId: tab.tabId, title: tab.title, detail }),
      processStarted: (pid, startedAt) => this.trackProcess(pid, startedAt),
      processExited: (pid) => this.trackProcess(pid)
    }
  }
}

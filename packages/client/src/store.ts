import type { Account, Effort, Home, Item, Palette, PermissionMode, ProtocolError, Request, TabEvent, TabMeta, TabSnapshot, TerminalMeta, Welcome, WorkspaceEvent, WorkspaceSnapshot } from '@athome/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'incompatible' | 'unauthorized'

// What the UI shows of one subscribed tab.
export type TabView = { items: Item[]; hasMore: boolean; requests: Request[] }

export type StoreState = {
  status: ConnectionStatus
  welcome?: Welcome
  // Fatal error that stopped the connection (incompatible protocol, unauthorized).
  error?: ProtocolError
  // Workspace tabs; undefined until the first workspace snapshot.
  tabs?: TabMeta[]
  // The backend's Home and its project folders (from the same snapshot).
  home?: Home
  projects?: string[]
  // Claude accounts of the backend (no tokens) and the account of new sessions (undefined = Claude Code's own login).
  accounts?: Account[]
  defaultAccount?: string
  // Claude Code's auto-compact window set from the app for every session; undefined = Claude Code's own setting.
  autoCompactWindow?: number
  // Effort and permission mode of new sessions; undefined = the model's effort, the 'default' mode.
  defaultEffort?: Effort
  defaultMode?: PermissionMode
  // Chat widgets on (the guide in every new session's system prompt).
  widgets?: boolean
  // The saved colour palettes of the backend (shared by every device).
  palettes: Palette[]
  // The backend's terminals (shared by every client).
  terminals: TerminalMeta[]
  // Transcripts of the subscribed tabs, by tabId.
  transcripts: Record<string, TabView>
  // Bumped when a folder's notes change (by folder): a screen showing them reads them again.
  notesVersion: Record<string, number>
}

// Client-side copy of the core state the UI displays. Every change produces a new state object
// (useSyncExternalStore-ready: getSnapshot/subscribe).
export class Store {
  private state: StoreState = { status: 'connecting', palettes: [], terminals: [], transcripts: {}, notesVersion: {} }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): StoreState => this.state

  // Registers a change listener. Returns the unsubscribe function.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setConnection(status: ConnectionStatus, extra: Pick<StoreState, 'welcome' | 'error'> = {}): void {
    this.set({ ...this.state, status, ...extra })
  }

  applyWorkspaceReset(snapshot: WorkspaceSnapshot): void {
    this.set({ ...this.state, tabs: snapshot.tabs, home: snapshot.home, projects: snapshot.projects, accounts: snapshot.accounts, defaultAccount: snapshot.defaultAccount, autoCompactWindow: snapshot.autoCompactWindow, defaultEffort: snapshot.defaultEffort, defaultMode: snapshot.defaultMode, widgets: snapshot.widgets, terminals: snapshot.terminals, palettes: snapshot.palettes ?? [] })
  }

  applyTabReset(tabId: string, snapshot: TabSnapshot): void {
    const { items, hasMore, requests } = snapshot
    this.setTab(tabId, { items, hasMore, requests })
  }

  applyWorkspaceEvent(ev: WorkspaceEvent): void {
    const tabs = this.state.tabs ?? []
    if (ev.type === 'tab.added') this.set({ ...this.state, tabs: [...tabs.filter((tab) => tab.tabId !== ev.tab.tabId), ev.tab] })
    if (ev.type === 'tab.updated') this.set({ ...this.state, tabs: tabs.map((tab) => (tab.tabId === ev.tab.tabId ? ev.tab : tab)) })
    if (ev.type === 'tab.moved') {
      const moved = tabs.find((tab) => tab.tabId === ev.tabId)
      if (!moved) return
      const rest = tabs.filter((tab) => tab !== moved)
      this.set({ ...this.state, tabs: [...rest.slice(0, ev.index), moved, ...rest.slice(ev.index)] })
    }
    if (ev.type === 'tab.removed') {
      this.set({ ...this.state, tabs: tabs.filter((tab) => tab.tabId !== ev.tabId) })
      this.dropTab(ev.tabId)
    }
    if (ev.type === 'folders.updated') this.set({ ...this.state, home: ev.home, projects: ev.projects })
    if (ev.type === 'accounts.updated') this.set({ ...this.state, accounts: ev.accounts, defaultAccount: ev.defaultAccount })
    if (ev.type === 'palettes.updated') this.set({ ...this.state, palettes: ev.palettes })
    if (ev.type === 'settings.updated') this.set({ ...this.state, autoCompactWindow: ev.autoCompactWindow, defaultEffort: ev.defaultEffort, defaultMode: ev.defaultMode, widgets: ev.widgets })
    const { terminals } = this.state
    if (ev.type === 'terminal.added') this.set({ ...this.state, terminals: [...terminals.filter((one) => one.terminalId !== ev.terminal.terminalId), ev.terminal] })
    if (ev.type === 'terminal.updated') this.set({ ...this.state, terminals: terminals.map((one) => (one.terminalId === ev.terminal.terminalId ? ev.terminal : one)) })
    if (ev.type === 'terminal.removed') this.set({ ...this.state, terminals: terminals.filter((one) => one.terminalId !== ev.terminalId) })
    if (ev.type === 'notes.changed') {
      const notesVersion = { ...this.state.notesVersion, [ev.cwd]: (this.state.notesVersion[ev.cwd] ?? 0) + 1 }
      this.set({ ...this.state, notesVersion })
    }
  }

  applyTabEvent(tabId: string, ev: TabEvent): void {
    const view = this.state.transcripts[tabId]
    if (view) this.setTab(tabId, applyToView(view, ev))
  }

  dropTab(tabId: string): void {
    if (!(tabId in this.state.transcripts)) return
    const { [tabId]: _dropped, ...transcripts } = this.state.transcripts
    this.set({ ...this.state, transcripts })
  }

  private setTab(tabId: string, view: TabView): void {
    this.set({ ...this.state, transcripts: { ...this.state.transcripts, [tabId]: view } })
  }

  private set(next: StoreState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

// Applies one tab event to a view, returning a new view.
function applyToView(view: TabView, ev: TabEvent): TabView {
  switch (ev.type) {
    case 'item.added':
      return { ...view, items: [...view.items, ev.item] }
    case 'item.updated':
      return { ...view, items: view.items.map((item) => (item.itemId === ev.item.itemId ? ev.item : item)) }
    case 'item.text':
      return { ...view, items: view.items.map((item) => (item.itemId === ev.itemId && 'text' in item ? { ...item, text: item.text + ev.append } : item)) }
    case 'request.opened':
      return { ...view, requests: [...view.requests, ev.request] }
    case 'request.resolved':
    case 'request.cancelled':
      return { ...view, requests: view.requests.filter((request) => request.requestId !== ev.requestId) }
  }
}

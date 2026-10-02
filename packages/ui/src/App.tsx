import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Connection, StoreState } from '@claude-wrap/client'
import type { TabMeta } from '@claude-wrap/protocol'
import { ChatView } from './ChatView.tsx'
import { t } from './i18n.ts'
import { StartScreen } from './StartScreen.tsx'
import { TabBar } from './TabBar.tsx'
import { readActiveTab, writeActiveTab } from './viewState.ts'

// Host abilities the UI may use when present (desktop: native folder picker, system browser, notifications).
export type Capabilities = {
  chooseFolder?: () => Promise<string | undefined>
  openExternal?: (url: string) => void
  // A system notification was clicked: show that tab. Returns the unsubscribe function.
  onActivateTab?: (listener: (tabId: string) => void) => () => void
  // The local backend crashed too often and will not come back.
  onCoreFailed?: (listener: () => void) => () => void
}

export interface AppProps {
  // Link to the backend; the App starts it and renders its store.
  connection: Connection
  capabilities: Capabilities
}

// The active tab id, remembered per backend; 'start' = the start screen of a new tab.
function useActiveTab(state: StoreState, backendId: string, capabilities: Capabilities) {
  const [chosen, setChosen] = useState<string>()
  useEffect(() => setChosen(readActiveTab(backendId)), [backendId])
  useEffect(() => capabilities.onActivateTab?.((tabId) => setChosen(tabId)), [capabilities])
  const choose = (tabId: string) => {
    setChosen(tabId)
    writeActiveTab(backendId, tabId === 'start' ? undefined : tabId)
  }
  const tabs = state.tabs ?? []
  const active = chosen === 'start' ? undefined : (tabs.find((tab) => tab.tabId === chosen) ?? tabs[0])
  return { active, choose }
}

// Announces when a tab that is NOT shown starts waiting for an answer (its aria-live region is not mounted).
function useWaitingAnnouncement(tabs: TabMeta[], activeId: string | undefined): string {
  const previous = useRef(new Map<string, string>())
  const [text, setText] = useState('')
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.status === 'requires_action' && previous.current.get(tab.tabId) !== 'requires_action' && tab.tabId !== activeId) setText(t('announceWaiting', { title: tab.title }))
      previous.current.set(tab.tabId, tab.status)
    }
  }, [tabs, activeId])
  return text
}

// Root of the UI: connection state, tab bar, and the active tab's session (or the start screen).
// Only the shown tab is mounted, so only it is subscribed; the others report through the workspace stream.
export function App({ connection, capabilities }: AppProps) {
  const state = useSyncExternalStore(connection.store.subscribe, connection.store.getSnapshot)
  const backendId = state.welcome?.backendId ?? ''
  const [coreFailed, setCoreFailed] = useState(false)
  const { active, choose } = useActiveTab(state, backendId, capabilities)
  const waiting = useWaitingAnnouncement(state.tabs ?? [], active?.tabId)
  useEffect(() => connection.start(), [connection])
  useEffect(() => capabilities.onCoreFailed?.(() => setCoreFailed(true)), [capabilities])

  if (coreFailed) return <Status role="alert" text={t('coreFailed')} />
  if (state.error) return <Status role="alert" text={t('connectionFailed', { code: state.error.code, message: state.error.message })} />
  if (!state.welcome || !state.tabs) return <Status role="status" text={t('connecting')} />
  const tabs = state.tabs

  // Closing asks first if Claude is at work; the neighbour (or the start screen) is shown next.
  const close = (tab: TabMeta) => {
    if ((tab.status === 'running' || tab.status === 'requires_action') && !window.confirm(t('closeConfirm'))) return
    const index = tabs.indexOf(tab)
    if (tab.tabId === active?.tabId) choose(tabs[index + 1]?.tabId ?? tabs[index - 1]?.tabId ?? 'start')
    connection.request('tab.close', { tabId: tab.tabId }).catch(() => undefined)
  }

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={active?.tabId}
        onActivate={choose}
        onNew={() => choose('start')}
        onClose={close}
        onRename={(tab, title) => void connection.request('tab.rename', { tabId: tab.tabId, title }).catch(() => undefined)}
        onMove={(tab, index) => void connection.request('tab.reorder', { tabId: tab.tabId, index }).catch(() => undefined)}
      />
      <div className="sr-only" aria-live="assertive">
        {waiting}
      </div>
      {active ? (
        <div className="tab-panel" role="tabpanel" id={`panel-${active.tabId}`} aria-labelledby={`tab-${active.tabId}`}>
          <ChatView key={active.tabId} connection={connection} backendId={backendId} meta={active} view={state.transcripts[active.tabId]} openExternal={capabilities.openExternal} onOpenTab={choose} />
        </div>
      ) : (
        <StartScreen connection={connection} backendId={backendId} chooseFolder={capabilities.chooseFolder} onOpen={choose} />
      )}
      {state.status !== 'connected' && (
        <p className="connection-banner" role="status">
          {t('connecting')}
        </p>
      )}
      <p className="version-line">{t('versions', { core: state.welcome.coreVersion, sdk: state.welcome.sdkVersion, cli: state.welcome.cliVersion })}</p>
    </div>
  )
}

// Whole-screen state (connecting, connection refused, backend failed).
function Status({ role, text }: { role: 'status' | 'alert'; text: string }) {
  return (
    <main className="screen">
      <p role={role}>{text}</p>
    </main>
  )
}

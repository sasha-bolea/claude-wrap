import { useEffect, useState } from 'react'
import type { Connection, StoreState } from '@claude-wrap/client'
import type { TabMeta, Welcome } from '@claude-wrap/protocol'
import type { Capabilities } from './App.tsx'
import { ChatView } from './ChatView.tsx'
import { t } from './i18n.ts'
import { Icon } from './Icon.tsx'
import { SettingsScreen } from './SettingsScreen.tsx'
import { Sheet } from './Sheet.tsx'
import { StartScreen } from './StartScreen.tsx'
import { badgeOf, BADGE_LABEL } from './TabBar.tsx'

type Screen = { name: 'home' } | { name: 'chat'; tabId: string } | { name: 'new' } | { name: 'settings' }

type MobileAppProps = { connection: Connection; state: StoreState & { welcome: Welcome; tabs: TabMeta[] }; capabilities: Capabilities }

// Last part of a path (the folder name shown under a session).
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

// One open session on the home screen: badge, title, folder and state, and a ⋯ menu (rename, close).
function SessionRow({ tab, onOpen, onMenu }: { tab: TabMeta; onOpen: () => void; onMenu: () => void }) {
  const badge = badgeOf(tab)
  const queued = tab.queue.length ? ` · ${t('queuedCount', { count: String(tab.queue.length) })}` : ''
  return (
    <li className="m-row">
      <span className={`badge ${badge === 'idle' ? '' : badge}`} role="img" aria-label={t(BADGE_LABEL[badge])} />
      <button className="m-row-main" onClick={onOpen}>
        <span className="m-row-title">{tab.title}</span>
        <span className="m-row-sub">{`${folderName(tab.cwd)} · ${t(BADGE_LABEL[badge])}${queued}`}</span>
      </button>
      <button className="icon-button" aria-label={t('sessionActions', { title: tab.title })} onClick={onMenu}>
        <Icon name="more" />
      </button>
    </li>
  )
}

// Home of the phone: the open sessions (same as the desktop's tabs, in the same order), new session, settings.
function Home({ connection, state, onScreen }: { connection: Connection; state: MobileAppProps['state']; onScreen: (screen: Screen) => void }) {
  const [menu, setMenu] = useState<TabMeta>()
  const [renaming, setRenaming] = useState<string>()
  const close = (tab: TabMeta) => {
    setMenu(undefined)
    if ((tab.status === 'running' || tab.status === 'requires_action') && !window.confirm(t('closeConfirm'))) return
    connection.request('tab.close', { tabId: tab.tabId }).catch(() => undefined)
  }
  const rename = (tab: TabMeta) => {
    setMenu(undefined)
    if (renaming?.trim()) connection.request('tab.rename', { tabId: tab.tabId, title: renaming.trim() }).catch(() => undefined)
    setRenaming(undefined)
  }
  return (
    <div className="page">
      <header className="m-topbar">
        <div className="m-title">
          <h1 className="m-title-text">{t('sessions')}</h1>
          <span className="m-subtitle">{state.status === 'connected' ? t('connected') : t('connecting')}</span>
        </div>
        <button className="icon-button" aria-label={t('settings')} onClick={() => onScreen({ name: 'settings' })}>
          <Icon name="settings" />
        </button>
      </header>
      <div className="m-scroll">
        {state.tabs.length ? (
          <ul className="m-list">
            {state.tabs.map((tab) => (
              <SessionRow key={tab.tabId} tab={tab} onOpen={() => onScreen({ name: 'chat', tabId: tab.tabId })} onMenu={() => setMenu(tab)} />
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noOpenSessions')}</p>
        )}
      </div>
      <div className="m-actions">
        <button className="button primary" onClick={() => onScreen({ name: 'new' })}>
          <Icon name="plus" />
          {t('newSession')}
        </button>
      </div>
      {menu && renaming === undefined && (
        <Sheet label={menu.title} onClose={() => setMenu(undefined)}>
          <ul className="menu">
            <li><button onClick={() => setRenaming(menu.title)}>{t('rename')}</button></li>
            <li><button className="danger" onClick={() => close(menu)}>{t('closeSession')}</button></li>
          </ul>
        </Sheet>
      )}
      {menu && renaming !== undefined && (
        <Sheet label={t('renameTab')} onClose={() => (setMenu(undefined), setRenaming(undefined))}>
          <input className="field" id="rename-tab" aria-label={t('renameTab')} value={renaming} onChange={(event) => setRenaming(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && rename(menu)} />
          <button className="button primary" onClick={() => rename(menu)}>{t('save')}</button>
        </Sheet>
      )}
    </div>
  )
}

// Touch layout (the PWA): one screen at a time — home, chat, new session, settings. A notification tap opens its
// session; a session closed elsewhere sends its chat back home.
export function MobileApp({ connection, state, capabilities }: MobileAppProps) {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  useEffect(() => capabilities.onActivateTab?.((tabId) => setScreen({ name: 'chat', tabId })), [capabilities])
  const home = () => setScreen({ name: 'home' })
  const chatTab = screen.name === 'chat' ? state.tabs.find((tab) => tab.tabId === screen.tabId) : undefined
  useEffect(() => {
    if (screen.name === 'chat' && !chatTab) home()
  }, [screen, chatTab])
  const backendId = state.welcome.backendId

  if (screen.name === 'chat' && chatTab) {
    const otherWaiting = state.tabs.some((tab) => tab.tabId !== chatTab.tabId && badgeOf(tab) === 'waiting')
    return (
      <ChatView
        key={chatTab.tabId}
        connection={connection}
        backendId={backendId}
        meta={chatTab}
        view={state.transcripts[chatTab.tabId]}
        openExternal={capabilities.openExternal}
        onOpenTab={(tabId) => setScreen({ name: 'chat', tabId })}
        mobile
        otherWaiting={otherWaiting}
        onBack={home}
      />
    )
  }
  if (screen.name === 'new') {
    return (
      <div className="page">
        <header className="m-topbar">
          <button className="icon-button" aria-label={t('back')} onClick={home}>
            <Icon name="back" />
          </button>
          <h1 className="m-title">{t('newSession')}</h1>
        </header>
        <div className="m-scroll">
          <StartScreen connection={connection} backendId={backendId} onOpen={(tabId) => setScreen({ name: 'chat', tabId })} />
        </div>
      </div>
    )
  }
  if (screen.name === 'settings') {
    return <SettingsScreen connection={connection} welcome={state.welcome} push={capabilities.push} pairLink={capabilities.pairLink ?? ((code) => code)} onLogout={capabilities.logout} onBack={home} />
  }
  return <Home connection={connection} state={state} onScreen={setScreen} />
}

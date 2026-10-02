import { useState, type KeyboardEvent } from 'react'
import type { TabMeta } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import type { MessageKey } from './i18n/en.ts'

type Badge = 'working' | 'waiting' | 'error' | 'idle'

const BADGE_LABEL: Record<Badge, MessageKey> = { working: 'badgeWorking', waiting: 'badgeWaiting', error: 'badgeError', idle: 'badgeIdle' }

// Badge of a tab from its status: working, waiting for the user (request or trust), error, idle.
export function badgeOf(tab: TabMeta): Badge {
  if (tab.status === 'requires_action' || tab.status === 'needs_trust') return 'waiting'
  if (tab.status === 'running' || tab.status === 'starting') return 'working'
  return tab.status === 'error' ? 'error' : 'idle'
}

type TabBarProps = {
  tabs: TabMeta[]
  // The shown tab, or undefined while the start screen of a new tab is shown.
  activeId?: string
  onActivate: (tabId: string) => void
  onNew: () => void
  onClose: (tab: TabMeta) => void
  onRename: (tab: TabMeta, title: string) => void
  onMove: (tab: TabMeta, index: number) => void
}

type TabProps = { tab: TabMeta; index: number; active: boolean } & Omit<TabBarProps, 'tabs' | 'activeId' | 'onNew'>

// One tab: status badge, title (double click or F2 renames), close. Ctrl+Shift+←/→ moves it.
// Renaming is confirmed only with Enter: losing focus (a dialog appearing, say) cancels it.
function Tab({ tab, index, active, onActivate, onClose, onRename, onMove }: TabProps) {
  const [editing, setEditing] = useState(false)
  const badge = badgeOf(tab)
  const confirm = (value: string) => {
    setEditing(false)
    if (value.trim() && value.trim() !== tab.title) onRename(tab, value.trim())
  }
  // Esc cancels the rename; preventDefault so the chat does not take it as "interrupt".
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') confirm(event.currentTarget.value)
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(false)
    }
  }
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') onActivate(tab.tabId)
    else if (event.key === 'F2') setEditing(true)
    else if (event.ctrlKey && event.shiftKey && event.key === 'ArrowLeft') onMove(tab, Math.max(0, index - 1))
    else if (event.ctrlKey && event.shiftKey && event.key === 'ArrowRight') onMove(tab, index + 1)
    else return
    event.preventDefault()
  }
  return (
    <div
      role="tab"
      id={`tab-${tab.tabId}`}
      aria-controls={`panel-${tab.tabId}`}
      aria-selected={active}
      tabIndex={0}
      className={`tab${active ? ' active' : ''}`}
      onClick={() => onActivate(tab.tabId)}
      onKeyDown={onTabKey}
    >
      <span className={`badge ${badge}`} role="img" aria-label={t(BADGE_LABEL[badge])} title={t(BADGE_LABEL[badge])} />
      {editing ? (
        <input
          className="field tab-field"
          aria-label={t('renameTab')}
          autoFocus
          defaultValue={tab.title}
          onKeyDown={onFieldKey}
          onBlur={() => setEditing(false)}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <span className="tab-title" title={tab.cwd} onDoubleClick={() => setEditing(true)}>
          {tab.title}
        </span>
      )}
      <button
        className="tab-close"
        aria-label={t('closeTab', { title: tab.title })}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab)
        }}
      >
        ×
      </button>
    </div>
  )
}

// The tab bar: one tab per open session, plus the button that opens a new one.
export function TabBar({ tabs, activeId, onNew, ...actions }: TabBarProps) {
  return (
    <nav className="tab-bar" role="tablist" aria-label={t('tabsLabel')}>
      {tabs.map((tab, index) => (
        <Tab key={tab.tabId} tab={tab} index={index} active={tab.tabId === activeId} {...actions} />
      ))}
      <button className="button new-tab" aria-label={t('newTab')} title={t('newTab')} aria-pressed={activeId === undefined} onClick={onNew}>
        +
      </button>
    </nav>
  )
}

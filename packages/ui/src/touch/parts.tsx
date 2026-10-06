import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DependencyList, type ReactNode } from 'react'
import type { TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useAvailableUpdate } from '../appUpdate.ts'
import { useTouch } from './context.tsx'
import { Icon, type IconName } from './icons.tsx'
import { sessionState, type SessionState } from './model.ts'

// Small pieces shared by the touch screens.

// Loads data when deps change (latest answer wins). reload() asks again; failures go to the toast.
export function useQuery<T>(load: () => Promise<T>, deps: DependencyList): { data?: T; reload: () => void } {
  const { fail } = useTouch()
  const [data, setData] = useState<T>()
  const latest = useRef(0)
  const run = useCallback(() => {
    const request = ++latest.current
    load().then(
      (value) => request === latest.current && setData(value),
      (error: unknown) => request === latest.current && fail(error)
    )
    // load is a fresh function every render: deps decide when to ask again.
  }, deps)
  useEffect(run, [run])
  return { data, reload: run }
}

type IconButtonProps = { icon: IconName; label: string; onClick: () => void; dot?: boolean; count?: string; countIcon?: IconName; className?: string; disabled?: boolean; expanded?: boolean }

// 44×44 icon button with its label for screen readers; dot: something waits elsewhere; count: a small number;
// countIcon: a small icon in the same badge instead (the queue's pause).
export function IconButton({ icon, label, onClick, dot, count, countIcon, className, disabled, expanded }: IconButtonProps) {
  return (
    <button className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} onClick={onClick} disabled={disabled} aria-expanded={expanded}>
      <Icon name={icon} />
      {dot && <span className="dot" />}
      {(count || countIcon) && (
        <span className="count" aria-hidden="true">
          {countIcon ? <Icon name={countIcon} /> : count}
        </span>
      )}
    </button>
  )
}

// Title of a top bar with its small line under it.
export function Title({ text, sub, padLeft }: { text: ReactNode; sub?: ReactNode; padLeft?: boolean }) {
  return (
    <h1 className={padLeft ? 'pad-left' : undefined}>
      <span className="title-main">{text}</span>
      {sub !== undefined && <span className="sub">{sub}</span>}
    </h1>
  )
}

// A path as buttons ("progetti / app / src"), scrolled to its end; a part jumps there (index in parts).
export function Crumbs({ parts, onJump }: { parts: string[]; onJump: (index: number) => void }) {
  const nav = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (nav.current) nav.current.scrollLeft = nav.current.scrollWidth
  }, [parts.join('/')])
  return (
    <nav className="crumbs path-bar" aria-label={t('path')} ref={nav}>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && (
            <span className="sep" aria-hidden="true">
              /
            </span>
          )}
          <button aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => onJump(index)}>
            {part}
          </button>
        </span>
      ))}
    </nav>
  )
}

// "Nuova versione disponibile · Aggiorna · ×" under the top bar of Home and chat; × hides it until a newer build.
export function UpdateBar() {
  const { capabilities } = useTouch()
  const app = capabilities.app
  const version = useAvailableUpdate(app)
  const [hidden, setHidden] = useState<string>()
  const [updating, setUpdating] = useState(false)
  if (!app || !version || hidden === version) return null
  return (
    <div className="update-bar" role="status">
      <span>{updating ? t('updating', { version }) : t('updateAvailable')}</span>
      <button className="button" disabled={updating} onClick={() => (setUpdating(true), app.reload())}>
        {t('update')}
      </button>
      <IconButton icon="close" label={t('updateLater')} onClick={() => setHidden(version)} />
    </div>
  )
}

// Under the top bar while the server cannot be reached: what you write goes when the line is back.
export function ConnectionBanner() {
  const { state } = useTouch()
  if (state.status === 'connected') return null
  return (
    <div className="banner" role="status">
      {t('offlineBanner')}
    </div>
  )
}

const STATE_LABEL = { waiting: 'stateWaiting', working: 'stateWorking', error: 'stateError', idle: 'stateIdle' } as const

// The status dot of a session (pulsing when it waits for you), with its meaning for screen readers.
export function Badge({ state }: { state: SessionState }) {
  return <span className={`badge ${state === 'idle' ? '' : state}`} role="img" aria-label={t(STATE_LABEL[state])} />
}

// The words of a session's state for a list row.
export function stateWords(tab: TabMeta): string {
  if (tab.status === 'needs_trust') return t('stateNeedsTrust')
  if (tab.status === 'starting') return t('stateStarting')
  return t(STATE_LABEL[sessionState(tab)])
}

// A note's title: its first line.
export const noteTitle = (text: string) => text.trim().split('\n')[0] || t('emptyNote')

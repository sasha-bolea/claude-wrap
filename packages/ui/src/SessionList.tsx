import { useRef, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { SessionInfo } from '@claude-wrap/protocol'
import { t } from './i18n.ts'

type SessionListProps = {
  connection: Connection
  cwd: string
  sessions: SessionInfo[]
  onOpen: (session: SessionInfo) => void
  // The list changed on disk (renamed, deleted): reload it.
  onChanged: () => void
}

type Mode = 'normal' | 'rename' | 'confirm'
type EntryProps = Omit<SessionListProps, 'sessions'> & { session: SessionInfo }

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

// One stored session: open it (or go to its tab), rename it, delete it with a two-step confirmation.
// Focus goes back to a sensible control after each mode change; errors show in every mode.
function SessionEntry({ connection, cwd, session, onOpen, onChanged }: EntryProps) {
  const [mode, setMode] = useState<Mode>('normal')
  const [error, setError] = useState<string>()
  const back = useRef<HTMLButtonElement>(null)
  const done = () => {
    setMode('normal')
    requestAnimationFrame(() => back.current?.focus())
  }
  const run = (action: Promise<unknown>) =>
    action.then(
      () => {
        setError(undefined)
        done()
        onChanged()
      },
      (failure: unknown) => setError(errorText(failure))
    )
  const rename = (title: string) => (title ? void run(connection.request('sessions.rename', { cwd, sessionId: session.sessionId, title })) : done())
  const open = Boolean(session.tabId)
  return (
    <li className="session-entry">
      {mode === 'rename' ? (
        <input
          className="field"
          aria-label={t('renameTab')}
          autoFocus
          defaultValue={session.title}
          onKeyDown={(event) => {
            if (event.key === 'Enter') rename(event.currentTarget.value.trim())
            if (event.key === 'Escape') {
              event.preventDefault()
              done()
            }
          }}
        />
      ) : (
        <button className="button session-open" onClick={() => onOpen(session)}>
          <span>
            {session.title} {open && <span className="chip">{t('sessionOpen')}</span>}
          </span>
          <span className="muted">
            {new Date(session.lastModified).toLocaleString()}
            {session.gitBranch ? ` · ${session.gitBranch}` : ''}
          </span>
        </button>
      )}
      <div className="actions">
        <button className="button" ref={mode === 'confirm' ? undefined : back} disabled={open} title={open ? t('closeItsTabFirst') : undefined} onClick={() => setMode('rename')}>
          {t('rename')}
        </button>
        {mode === 'confirm' ? (
          <>
            <button className="button danger" autoFocus onClick={() => void run(connection.request('sessions.delete', { cwd, sessionId: session.sessionId }))}>
              {t('confirmDelete')}
            </button>
            <button className="button" ref={back} onClick={done}>
              {t('cancel')}
            </button>
          </>
        ) : (
          <button className="button danger" disabled={open} title={open ? t('closeItsTabFirst') : undefined} onClick={() => setMode('confirm')}>
            {t('delete')}
          </button>
        )}
      </div>
      {error && (
        <p className="item notice error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

// Stored sessions of a folder, newest first (the CLI's /resume).
export function SessionList(props: SessionListProps) {
  if (!props.sessions.length) return <p className="muted">{t('noSessions')}</p>
  return (
    <ul className="session-list">
      {props.sessions.map((session) => (
        <SessionEntry key={session.sessionId} {...props} session={session} />
      ))}
    </ul>
  )
}

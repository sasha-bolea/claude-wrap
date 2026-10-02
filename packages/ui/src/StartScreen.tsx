import { useCallback, useEffect, useState } from 'react'
import type { Connection } from '@claude-wrap/client'
import type { SessionInfo } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { SessionList } from './SessionList.tsx'
import { TrustDialog, type TrustCheck } from './TrustDialog.tsx'
import { readRecentFolder, writeRecentFolder } from './viewState.ts'

type StartScreenProps = {
  connection: Connection
  backendId: string
  chooseFolder?: () => Promise<string | undefined>
  // A tab was created (new or resumed session) or an already open one was picked: show it.
  onOpen: (tabId: string) => void
}

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

// Folder of the start screen: its trust, and its stored sessions once trusted. Starts from the last folder used.
function useFolder(connection: Connection, backendId: string, onError: (failure: unknown) => void) {
  const [folder, setFolder] = useState(() => readRecentFolder(backendId))
  const [trust, setTrust] = useState<TrustCheck>()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const load = useCallback(async () => {
    if (!folder) return
    const check = await connection.request('trust.check', { cwd: folder })
    setTrust(check)
    if (check.trusted) setSessions((await connection.request('sessions.list', { cwd: folder })).sessions)
  }, [connection, folder])
  useEffect(() => void load().catch(onError), [load, onError])
  // Picking the folder already shown just refreshes it (the load effect would not run again).
  const choose = (path: string | undefined) => {
    if (path && path === folder) return void load().catch(onError)
    setTrust(undefined)
    setSessions([])
    setFolder(path)
    if (path) writeRecentFolder(backendId, path)
  }
  return { folder, trust, sessions, choose, reload: () => void load().catch(onError) }
}

// Start screen of a new tab: pick the working folder, trust it if needed, then open a new session or resume
// a stored one (an already open one goes to its tab).
export function StartScreen({ connection, backendId, chooseFolder, onOpen }: StartScreenProps) {
  const [error, setError] = useState<string>()
  const onError = useCallback((failure: unknown) => setError(t('openFailed', { message: errorText(failure) })), [])
  const { folder, trust, sessions, choose, reload } = useFolder(connection, backendId, onError)

  const create = (session?: SessionInfo) => {
    if (!folder) return
    if (session?.tabId) return onOpen(session.tabId)
    const args = { tabId: crypto.randomUUID(), cwd: folder, resume: session?.sessionId, title: session?.title }
    connection.request('tab.create', args).then(({ tabId }) => onOpen(tabId), onError)
  }
  const grant = () => {
    if (folder) connection.request('trust.grant', { cwd: folder }).then(reload, onError)
  }

  return (
    <div className="start">
      <h1>claude-wrap</h1>
      <p className="muted">{t('startHint')}</p>
      {chooseFolder ? (
        <div className="actions">
          <button className="button" onClick={() => void chooseFolder().then((path) => path && choose(path))}>
            {folder ? t('changeFolder') : t('chooseFolder')}
          </button>
          {folder && <span className="muted">{folder}</span>}
        </div>
      ) : (
        <p className="muted">{t('noFolderPicker')}</p>
      )}
      {folder && trust && !trust.trusted && <TrustDialog cwd={folder} check={trust} onAccept={grant} onCancel={() => choose(undefined)} />}
      {folder && trust?.trusted && (
        <>
          <div className="actions">
            <button className="button primary" onClick={() => create()}>
              {t('newSession')}
            </button>
          </div>
          <section>
            <h2 className="subtitle">{t('resumeSession')}</h2>
            <SessionList connection={connection} cwd={folder} sessions={sessions} onOpen={create} onChanged={reload} />
          </section>
        </>
      )}
      {error && (
        <p className="item notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

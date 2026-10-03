import { useState } from 'react'
import type { CommandResult, SessionInfo, TabMeta } from '@claude-wrap/protocol'
import { t } from '../i18n.ts'
import { readDraft } from '../viewState.ts'
import { useTouch } from './context.tsx'
import { baseName, sessionState } from './model.ts'
import { Badge, IconButton, stateWords } from './parts.tsx'

type TrustCheck = CommandResult<'trust.check'>

// Sessions in the touch layout: open ones (tabs) and saved ones, their rows, menus and the start of a new one.

// A date as the lists show it: the time today, otherwise day and month.
export function when(ms: number): string {
  const date = new Date(ms)
  const today = new Date().toDateString() === date.toDateString()
  return today ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// Runs onTrusted once the folder is trusted: at once, or after "Sì, mi fido" in the trust sheet (which says what
// Claude may do there and what the project would load and run).
export function useTrustPrompt() {
  const { connection, openSheet, fail } = useTouch()
  return (cwd: string, onTrusted: () => void) =>
    connection.request('trust.check', { cwd }).then((check) => (check.trusted ? onTrusted() : openSheet({ title: t('trustTitle'), path: cwd, body: <TrustSheet cwd={cwd} check={check} onTrusted={onTrusted} /> })), fail)
}

// Starts a session in a folder: trust first if the folder is not trusted yet, then the new chat.
export function useStartSession() {
  const { connection, closeSheets, go, fail } = useTouch()
  const askTrust = useTrustPrompt()
  const open = async (cwd: string) => {
    const tabId = crypto.randomUUID()
    await connection.request('tab.create', { tabId, cwd })
    closeSheets()
    go({ name: 'chat', tabId })
  }
  return (cwd: string) => askTrust(cwd, () => void open(cwd).catch(fail))
}

// "Ti fidi di questa cartella?": never focused on the granting button (it is not first, and the sheet focuses its
// title).
function TrustSheet({ cwd, check, onTrusted }: { cwd: string; check: TrustCheck; onTrusted: () => void }) {
  const { connection, closeSheet, closeSheets, fail } = useTouch()
  const { config, scope } = check
  const groups: [string, string[]][] = [
    [t('trustHooks'), config.hooks],
    [t('trustMcp'), config.mcp],
    [t('trustPermissions'), config.permissions],
    [t('trustRisks'), config.risks]
  ]
  const grant = () => connection.request('trust.grant', { cwd }).then(() => (closeSheets(), onTrusted()), fail)
  return (
    <>
      <p className="flat">{t('trustBody')}</p>
      {groups
        .filter(([, items]) => items.length)
        .map(([title, items]) => (
          <div key={title}>
            <strong>{title}</strong>
            <ul className="config-list">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      <p className="muted flat">
        {scope.sessionOnly ? t('trustSessionOnly') : t('trustScope', { path: scope.path })}
      </p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button primary" onClick={() => void grant()}>
          {t('trustYes')}
        </button>
      </div>
    </>
  )
}

// One open session as a row: status, title, folder and state, what waits (queue, draft), and its ⋯ menu.
function SessionRow({ tab, withFolder }: { tab: TabMeta; withFolder?: boolean }) {
  const { go, openSheet, backendId } = useTouch()
  const draft = readDraft(backendId, tab.tabId).trim()
  return (
    <li className="row">
      <Badge state={sessionState(tab)} />
      <button className="row-main" onClick={() => go({ name: 'chat', tabId: tab.tabId })}>
        <span className="row-title">{tab.title}</span>
        <span className="row-sub">{`${withFolder ? `${baseName(tab.cwd)} · ` : ''}${stateWords(tab)}`}</span>
        {(tab.queue.length > 0 || draft) && (
          <span className="row-chips">
            {tab.queue.length > 0 && <span className="chip">{t('queuedCount', { count: String(tab.queue.length) })}</span>}
            {draft && <span className="chip">{t('draftChip')}</span>}
          </span>
        )}
      </button>
      <IconButton icon="more" label={t('sessionActions', { title: tab.title })} onClick={() => openSheet({ title: tab.title, path: tab.cwd, body: <SessionSheet tabId={tab.tabId} /> })} />
    </li>
  )
}

// Menu of an open session: open, rename, fork, restart (after a crash), close (asks first while Claude works).
function SessionSheet({ tabId }: { tabId: string }) {
  const { state, connection, go, openSheet, closeSheets, toast, fail } = useTouch()
  const tab = state.tabs.find((entry) => entry.tabId === tabId)
  if (!tab) return null
  const fork = () =>
    connection.request('tab.fork', { tabId, newTabId: crypto.randomUUID() }).then(() => {
      closeSheets()
      toast(t('forked', { title: `${tab.title} (fork)` }))
    }, fail)
  const restart = () =>
    connection.request('tab.restart', { tabId }).then(() => {
      closeSheets()
      toast(t('restarted'))
    }, fail)
  return (
    <ul className="menu">
      <li>
        <button onClick={() => (closeSheets(), go({ name: 'chat', tabId }))}>{t('open')}</button>
      </li>
      <li>
        <button onClick={() => openSheet({ title: t('rename'), field: true, body: <RenameSheet tabId={tabId} current={tab.title} /> })}>{t('rename')}</button>
      </li>
      <li>
        <button onClick={() => void fork()}>{t('forkLong')}</button>
      </li>
      {tab.status === 'error' && (
        <li>
          <button onClick={() => void restart()}>
            {t('restartClaude')}
            <span className="right">{t('processStoppedShort')}</span>
          </button>
        </li>
      )}
      <li>
        <CloseButton tab={tab} />
      </li>
    </ul>
  )
}

// Close a session: at once when Claude is idle, after a confirmation while it works.
export function CloseButton({ tab }: { tab: TabMeta }) {
  const { connection, openSheet, closeSheets, toast, fail } = useTouch()
  const working = tab.status === 'running' || tab.status === 'requires_action' || tab.status === 'starting'
  const close = () =>
    connection.request('tab.close', { tabId: tab.tabId }).then(() => {
      closeSheets()
      toast(t('sessionClosed'))
    }, fail)
  return (
    <button className="danger" onClick={() => (working ? openSheet({ title: t('closeConfirmTitle', { title: tab.title }), body: <CloseConfirm tab={tab} onClose={close} /> }) : void close())}>
      {t('closeSession')}
      {working && <span className="right">{t('stopsClaude')}</span>}
    </button>
  )
}

function CloseConfirm({ tab, onClose }: { tab: TabMeta; onClose: () => void }) {
  const { closeSheet } = useTouch()
  return (
    <>
      <p className="flat">{t(tab.queue.length ? 'closeConfirmQueue' : 'closeConfirmBody')}</p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={onClose}>
          {t('closeAnyway')}
        </button>
      </div>
    </>
  )
}

// Rename an open session (tab and stored session) or a saved one.
export function RenameSheet({ tabId, current, saved }: { tabId?: string; current: string; saved?: { cwd: string; sessionId: string; onDone: () => void } }) {
  const { connection, closeSheet, toast, fail } = useTouch()
  const [title, setTitle] = useState(current)
  const save = () => {
    const value = title.trim()
    if (!value) return
    const request = tabId ? connection.request('tab.rename', { tabId, title: value }) : connection.request('sessions.rename', { cwd: saved!.cwd, sessionId: saved!.sessionId, title: value })
    request.then(() => {
      saved?.onDone()
      closeSheet()
      toast(t('renamed'))
    }, fail)
  }
  return (
    <>
      <input className="field" aria-label={t('newName')} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && save()} />
      <button className="button primary block" onClick={save}>
        {t('save')}
      </button>
    </>
  )
}

// A saved session as a row: title, folder (in the list of every folder), date and branch; ⋯ to resume, rename, delete.
function StoredRow({ session, folder, withFolder, onChange }: { session: SessionInfo; folder: string; withFolder?: boolean; onChange: () => void }) {
  const { openSheet } = useTouch()
  const resume = useResume()
  const cwd = session.cwd ?? folder
  const sub = [withFolder ? baseName(cwd) : undefined, when(session.lastModified), session.gitBranch].filter(Boolean).join(' · ')
  return (
    <li className="row">
      <button className="row-main" onClick={() => resume(session, cwd)}>
        <span className="row-title">{session.title}</span>
        <span className="row-sub">{sub}</span>
      </button>
      <IconButton icon="more" label={t('sessionActions', { title: session.title })} onClick={() => openSheet({ title: session.title, path: cwd, body: <StoredSheet session={session} cwd={cwd} onChange={onChange} /> })} />
    </li>
  )
}

// Opens a saved session: in its tab if it is open already, else in a new tab resuming it.
function useResume() {
  const { connection, go, closeSheets, fail } = useTouch()
  return (session: SessionInfo, cwd: string) => {
    closeSheets()
    if (session.tabId) return go({ name: 'chat', tabId: session.tabId })
    connection.request('tab.create', { tabId: crypto.randomUUID(), cwd, resume: session.sessionId, title: session.title }).then(({ tabId }) => go({ name: 'chat', tabId }), fail)
  }
}

// Menu of a saved session: resume (or open, when open), rename and delete (only when not open).
function StoredSheet({ session, cwd, onChange }: { session: SessionInfo; cwd: string; onChange: () => void }) {
  const { openSheet } = useTouch()
  const resume = useResume()
  const open = Boolean(session.tabId)
  return (
    <ul className="menu">
      <li>
        <button onClick={() => resume(session, cwd)}>{open ? t('openAlreadyOpen') : t('resume')}</button>
      </li>
      <li>
        <button disabled={open} onClick={() => openSheet({ title: t('rename'), field: true, body: <RenameSheet current={session.title} saved={{ cwd, sessionId: session.sessionId, onDone: onChange }} /> })}>
          {t('rename')}
          {open && <span className="right">{t('closeItFirst')}</span>}
        </button>
      </li>
      <li>
        <button className="danger" disabled={open} onClick={() => openSheet({ title: t('deleteSessionTitle', { title: session.title }), body: <StoredDelete session={session} cwd={cwd} onChange={onChange} /> })}>
          {t('delete')}
          {open && <span className="right">{t('closeItFirst')}</span>}
        </button>
      </li>
    </ul>
  )
}

function StoredDelete({ session, cwd, onChange }: { session: SessionInfo; cwd: string; onChange: () => void }) {
  const { connection, closeSheet, closeSheets, toast, fail } = useTouch()
  const remove = () =>
    connection.request('sessions.delete', { cwd, sessionId: session.sessionId }).then(() => {
      onChange()
      closeSheets()
      toast(t('sessionDeleted'))
    }, fail)
  return (
    <>
      <p className="flat">{t('deleteSessionBody')}</p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={() => void remove()}>
          {t('delete')}
        </button>
      </div>
    </>
  )
}

// The lists of a folder's (or every folder's) sessions: open ones and saved ones.
export function SessionLists({ open, stored, folder, withFolder, onChange }: { open: TabMeta[]; stored?: SessionInfo[]; folder: string; withFolder?: boolean; onChange: () => void }) {
  return (
    <>
      <p className="label">{t('openSessions')}</p>
      <ul className="list">
        {open.map((tab) => (
          <SessionRow key={tab.tabId} tab={tab} withFolder={withFolder} />
        ))}
        {!open.length && (
          <li className="row">
            <span className="muted">{t('noOpenSessionsShort')}</span>
          </li>
        )}
      </ul>
      <p className="label spaced">{t('pastSessions')}</p>
      <ul className="list">
        {stored?.map((session) => (
          <StoredRow key={session.sessionId} session={session} folder={folder} withFolder={withFolder} onChange={onChange} />
        ))}
        {stored && !stored.length && (
          <li className="row">
            <span className="muted">{t('noPastSessions')}</span>
          </li>
        )}
      </ul>
    </>
  )
}


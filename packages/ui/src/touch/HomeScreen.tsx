import { useEffect, useState } from 'react'
import type { FolderEntry, TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useBackHandler, useScreen, useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { badgeClass, baseName, folderSummary, inside, type SessionState } from './model.ts'
import { ConnectionBanner, Crumbs, IconButton, Title, UpdateBar, useQuery } from './parts.tsx'
import { BackendSwitch } from './backends.tsx'
import { OpenSessions, pastOnly, SessionLists, useStartSession } from './sessions.tsx'
import { OpenTerminals, useOpenTerminal } from './TerminalScreen.tsx'

const VIEW_KEY = 'claude-wrap:homeView'
type View = 'projects' | 'sessions'

// The Home's view (Progetti or Sessioni), remembered on this device. asked: a view to open on instead (remembered).
function useHomeView(asked?: View): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      if (asked) localStorage.setItem(VIEW_KEY, asked)
      return asked ?? (localStorage.getItem(VIEW_KEY) === 'sessions' ? 'sessions' : 'projects')
    } catch {
      return asked ?? 'projects'
    }
  })
  const choose = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // storage unavailable: the view is a convenience
    }
  }
  return [view, choose]
}

// "12 file di cui 3 nascosti" (the hidden part only when there are some).
const filesWords = ({ count, hidden }: { count: number; hidden: number }) =>
  `${t(count === 1 ? 'filesOne' : 'filesCount', { count: String(count) })}${hidden ? t(hidden === 1 ? 'filesHiddenOne' : 'filesHidden', { hidden: String(hidden) }) : ''}`

const isProject = (projects: string[], path: string) => projects.some((project) => inside(path, project) && inside(project, path))

const SUMMARY_WORDS: Record<SessionState, 'stateWaiting' | 'stateWorking' | 'stateError' | 'stateIdle'> = { waiting: 'stateWaiting', working: 'stateWorking', error: 'stateError', idle: 'stateIdle' }

// One folder of the Home: project (accent icon; tap = its sessions) or plain folder (tap = inside), with the open
// sessions inside it and its ⋯ menu.
function FolderRow({ entry, project, tabs, onEnter, onChanged }: { entry: FolderEntry; project: boolean; tabs: TabMeta[]; onEnter: (path: string) => void; onChanged: () => void }) {
  const { go, openSheet } = useTouch()
  const summary = folderSummary(tabs, entry.path)
  return (
    <li className="row">
      <span role="img" aria-label={t(project ? 'project' : 'folder')}>
        <Icon name="folder" className={`ficon${project ? ' dir' : ''}`} />
      </span>
      <button className="row-main" onClick={() => (project ? go({ name: 'folderSessions', path: entry.path }) : onEnter(entry.path))}>
        <span className="row-title">{entry.name}</span>
        {summary.open > 0 && (
          <span className="row-sub folder-status">
            <span className={badgeClass(summary.state, summary.unseen)} aria-hidden="true" />
            {`${t(summary.open === 1 ? 'oneOpenSession' : 'openSessionsCount', { count: String(summary.open) })} · ${t(SUMMARY_WORDS[summary.state])}`}
          </span>
        )}
      </button>
      <IconButton icon="more" label={t('folderActions', { name: entry.name })} onClick={() => openSheet({ title: entry.name, path: entry.path, body: <FolderMenu entry={entry} onEnter={onEnter} onChanged={onChanged} /> })} />
    </li>
  )
}

// Home: the folders of the backend (server: its root; this PC: the added folders), with the sessions of the folder
// shown and a new session right there; or every session (the Sessioni view). Back goes up one folder first.
// view: the view to open on (otherwise the one remembered).
export function HomeScreen({ view: asked }: { view?: View }) {
  const { state, connection, go, openSheet, wide, capabilities, fail } = useTouch()
  const { top } = useScreen()
  const startSession = useStartSession()
  const [view, setView] = useHomeView(asked)
  const [trail, setTrail] = useState<string[]>([])
  const home = state.home
  const root = home.kind === 'root' ? home.path : undefined
  const current = trail.at(-1) ?? root
  useBackHandler(trail.length > 0 && view === 'projects', () => setTrail((path) => path.slice(0, -1)))

  const listing = useQuery(() => (current ? connection.request('folders.list', { path: current }) : Promise.resolve(undefined)), [connection, current])
  const stored = useQuery(() => (current ? connection.request('sessions.list', { cwd: current }) : Promise.resolve(undefined)), [connection, current, state.tabs.length])
  const trash = useQuery(() => connection.request('trash.list', {}), [connection])
  const everySession = useQuery(() => (view === 'sessions' ? connection.request('sessions.list', {}) : Promise.resolve(undefined)), [connection, view, state.tabs.length])
  // Back on top (after a delete, a restore, a new session): lists again.
  useEffect(() => {
    if (!top) return
    listing.reload()
    stored.reload()
    trash.reload()
  }, [top])

  const waitingAnywhere = state.tabs.some((tab) => tab.status === 'requires_action')
  const enter = (path: string) => setTrail((path0) => [...path0, path])
  // This PC: a folder chosen in the system's dialog joins the Home (its files stay where they are).
  const addFolder = async () => {
    const path = await capabilities.chooseFolder!()
    if (path) await connection.request('folders.add', { path }).catch(fail)
  }
  const added = home.kind === 'added' && !trail.length
  const folders: FolderEntry[] = added ? home.folders.map((path) => ({ name: baseName(path), path, project: false })) : (listing.data?.folders ?? [])
  const name = current ? baseName(current) : t('thisComputer')
  // The files right inside the folder shown (none: no row).
  const files = current && listing.data?.files.count ? listing.data.files : undefined
  const connected = (
    <>
      <span className={`conn-dot${state.status === 'connected' ? '' : ' off'}`} aria-hidden="true" />
      {state.status === 'connected' ? t('serverConnected') : t('serverConnecting')}
    </>
  )

  return (
    <section className="screen" aria-label={t(view === 'sessions' ? 'sessions' : 'foldersTitle')}>
      <BackendSwitch />
      <header className="topbar">
        {view === 'projects' && trail.length > 0 && <IconButton icon="back" label={t('upTo', { name: baseName(trail.at(-2) ?? root ?? '') || t('thisComputer') })} onClick={() => setTrail((path) => path.slice(0, -1))} />}
        {view === 'sessions' ? (
          <Title text={t('sessions')} sub={connected} padLeft />
        ) : (
          <Title text={name} sub={trail.length ? current : connected} padLeft={!trail.length} />
        )}
        {view === 'projects' && current && <IconButton icon="folder-plus" label={t('newFolder')} onClick={() => openSheet({ title: t('newFolderIn', { path: current }), field: true, body: <NewFolderSheet parent={current} atRoot={!trail.length} onDone={listing.reload} /> })} />}
        <IconButton
          icon={view === 'sessions' ? 'folder' : 'chats'}
          label={view === 'sessions' ? t('showProjects') : waitingAnywhere ? t('showSessionsWaiting') : t('showSessions')}
          dot={view === 'projects' && waitingAnywhere}
          onClick={() => setView(view === 'sessions' ? 'projects' : 'sessions')}
        />
        <IconButton icon="gear" label={t('settings')} onClick={() => go({ name: 'settings' })} />
      </header>
      <UpdateBar />
      <ConnectionBanner />
      {view === 'projects' && trail.length > 0 && <Crumbs parts={[root ? baseName(root) : t('thisComputer'), ...trail.map(baseName)]} onJump={(index) => setTrail((path) => path.slice(0, index))} />}
      <div className="scroll">
        <div className="pad tight">
          {view === 'sessions' ? (
            <>
              <OpenTerminals />
              <SessionLists open={state.tabs} stored={everySession.data?.sessions} folder="" withFolder onChange={everySession.reload} />
            </>
          ) : (
            <>
              {wide && <OpenSessions />}
              {wide && <OpenTerminals />}
              {wide && (state.tabs.length > 0 || state.terminals.length > 0) && <p className="label spaced">{t('foldersTitle')}</p>}
              <ul className="list">
                {folders.map((entry) => (
                  <FolderRow key={entry.path} entry={entry} project={isProject(state.projects, entry.path)} tabs={state.tabs} onEnter={enter} onChanged={listing.reload} />
                ))}
                {!folders.length && listing.data && !files && (
                  <li className="row">
                    <span className="muted">{t('noSubfolders')}</span>
                  </li>
                )}
                {files && current && (
                  <li className="row">
                    <Icon name="file" className="ficon" />
                    <button className="row-main" onClick={() => go({ name: 'files', folder: current })}>
                      <span className="row-title plain">{filesWords(files)}</span>
                    </button>
                    <Icon name="chevron" className="chevron" />
                  </li>
                )}
                {added && capabilities.chooseFolder && (
                  <li className="row">
                    <Icon name="folder-plus" className="ficon dir" />
                    <button className="row-main" onClick={() => void addFolder()}>
                      <span className="row-title plain">{t('addFolderEllipsis')}</span>
                    </button>
                  </li>
                )}
                {!trail.length && home.kind === 'root' && (
                  <li className="row">
                    <Icon name="trash" className="ficon" />
                    <button className="row-main" onClick={() => go({ name: 'trash' })}>
                      <span className="row-title plain">{t('recentlyDeleted')}</span>
                    </button>
                    {Boolean(trash.data?.items.length) && <span className="chip">{trash.data!.items.length}</span>}
                    <Icon name="chevron" className="chevron" />
                  </li>
                )}
              </ul>
              {current && (
                <div className="home-extra-wrap">
                  <p className="label">{t('ofThisFolder')}</p>
                  <div className="home-extra">
                    <button className="link-btn" aria-label={t('pastSessionsOf', { name })} onClick={() => go({ name: 'folderSessions', path: current })}>
                      <Icon name="history" />
                      {t('pastSessions')}
                      {Boolean(pastOnly(stored.data?.sessions)?.length) && <span className="link-count">{pastOnly(stored.data?.sessions)!.length}</span>}
                    </button>
                    <button className="link-btn" aria-label={t('newSessionIn', { name })} onClick={() => void startSession(current)}>
                      <Icon name="plus" />
                      {t('newSession')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// "Nuova sessione con nome…": the tab's title, also the name other sessions find it by, kept.
function NamedSessionSheet({ cwd }: { cwd: string }) {
  const startSession = useStartSession()
  const [name, setName] = useState('')
  const create = () => name.trim() && startSession(cwd, name.trim())
  return (
    <>
      <input className="field" aria-label={t('sessionName')} autoComplete="off" autoCapitalize="off" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
      <button className="button primary block" disabled={!name.trim()} onClick={create}>
        {t('create')}
      </button>
    </>
  )
}

// Menu of a folder: open, a new session there (also with a name), its saved sessions, project mark, delete (this
// PC: take it off the list, files stay).
function FolderMenu({ entry, onEnter, onChanged }: { entry: FolderEntry; onEnter: (path: string) => void; onChanged: () => void }) {
  const { state, connection, go, openSheet, closeSheets, toast, fail } = useTouch()
  const startSession = useStartSession()
  const openTerminal = useOpenTerminal()
  const project = isProject(state.projects, entry.path)
  const addedTop = state.home.kind === 'added' && state.home.folders.includes(entry.path)
  const mark = () =>
    connection.request('folders.setProject', { path: entry.path, project: !project }).then(() => {
      closeSheets()
      toast(t(project ? 'noLongerProject' : 'nowProject', { name: entry.name }))
    }, fail)
  const takeOff = () => connection.request('folders.remove', { path: entry.path }).then(() => (closeSheets(), toast(t('takenOffList', { name: entry.name }))), fail)
  return (
    <ul className="menu">
      <li>
        <button onClick={() => (closeSheets(), onEnter(entry.path))}>
          <Icon name="folder" />
          {t(project ? 'openContent' : 'open')}
        </button>
      </li>
      <li>
        <button onClick={() => void startSession(entry.path)}>
          <Icon name="plus" />
          {t('newSessionHere')}
        </button>
      </li>
      <li>
        <button onClick={() => openSheet({ title: t('newNamedSession'), field: true, body: <NamedSessionSheet cwd={entry.path} /> })}>
          <Icon name="plus" />
          {t('newNamedSession')}
        </button>
      </li>
      <li>
        <button onClick={() => openTerminal({ folder: entry.path })}>
          <Icon name="terminal" />
          {t('terminalHere')}
        </button>
      </li>
      {!project && (
        <li>
          <button onClick={() => (closeSheets(), go({ name: 'folderSessions', path: entry.path }))}>
            <Icon name="history" />
            {t('pastSessions')}
          </button>
        </li>
      )}
      <li>
        <button onClick={() => void mark()}>
          <Icon name="folder" className={project ? undefined : 'accent'} />
          {t(project ? 'unmarkProject' : 'markProject')}
        </button>
      </li>
      <li>
        {addedTop ? (
          <button onClick={() => void takeOff()}>
            <Icon name="close" />
            {t('takeOffList')}
          </button>
        ) : (
          <button className="danger" onClick={() => openSheet({ title: t('deleteFolderTitle', { name: entry.name }), body: <FolderDelete entry={entry} onChanged={onChanged} /> })}>
            <Icon name="trash" />
            {t('delete')}
          </button>
        )}
      </li>
    </ul>
  )
}

// Delete a folder: to the trash (7 days), undo right away. With sessions open inside it, it says so and the button
// closes them too (their conversations stay among the saved sessions).
// onChanged: the folder list is shown again (after the delete and after the undo).
function FolderDelete({ entry, onChanged }: { entry: FolderEntry; onChanged: () => void }) {
  const { state, connection, closeSheet, closeSheets, snack, toast, fail } = useTouch()
  const open = state.tabs.filter((tab) => inside(tab.cwd, entry.path)).length
  const systemTrash = state.home.kind === 'added'
  const restore = () =>
    connection
      .request('trash.list', {})
      .then(({ items }) => {
        const item = items.find((candidate) => candidate.path === entry.path)
        return item && connection.request('trash.restore', { id: item.id })
      })
      .then(() => (onChanged(), toast(t('restoredIn', { path: entry.path }))), fail)
  const remove = () =>
    connection.request('folders.delete', { path: entry.path, closeSessions: open > 0 }).then(() => {
      closeSheets()
      onChanged()
      if (systemTrash) toast(t('inSystemTrash', { name: entry.name }))
      else snack(t('movedToTrash', { name: entry.name }), () => void restore())
    }, fail)
  return (
    <>
      {open > 0 && <p className="flat">{t(open === 1 ? 'folderHasSession' : 'folderHasSessions', { count: String(open) })}</p>}
      <p className="flat">{t(systemTrash ? 'deleteFolderSystem' : 'deleteFolderBody')}</p>
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" onClick={() => void remove()}>
          {t(open > 0 ? 'deleteFolderAndSessions' : 'delete')}
        </button>
      </div>
    </>
  )
}

// New folder in the folder shown; at the root it is a project unless unticked.
function NewFolderSheet({ parent, atRoot, onDone }: { parent: string; atRoot: boolean; onDone: () => void }) {
  const { connection, closeSheet, toast, fail } = useTouch()
  const [name, setName] = useState('')
  const [project, setProject] = useState(atRoot)
  const create = () => {
    if (!name.trim()) return
    connection.request('folders.create', { path: parent, name: name.trim(), project }).then(() => {
      closeSheet()
      onDone()
      toast(t('folderCreated', { name: name.trim() }))
    }, fail)
  }
  return (
    <>
      <input
        className="field"
        aria-label={t('folderName')}
        placeholder={t(project ? 'projectNamePlaceholder' : 'folderNamePlaceholder')}
        autoComplete="off"
        autoCapitalize="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && create()}
      />
      <label className="check-row">
        <input type="checkbox" checked={project} onChange={(event) => setProject(event.target.checked)} />
        <span>
          <strong>{t('isProject')}</strong>
        </span>
      </label>
      <button className="button primary block" disabled={!name.trim()} onClick={create}>
        {t('create')}
      </button>
    </>
  )
}

// The sessions of one folder: open ones (also those in its subfolders) and saved ones, and a new session there.
export function FolderSessionsScreen({ path }: { path: string }) {
  const { state, connection, back, go } = useTouch()
  const { top } = useScreen()
  const startSession = useStartSession()
  const stored = useQuery(() => connection.request('sessions.list', { cwd: path }), [connection, path, state.tabs.length])
  useEffect(() => {
    if (top) stored.reload()
  }, [top])
  return (
    <section className="screen" aria-label={t('folderSessionsTitle')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={baseName(path)} sub={path} />
        <IconButton icon="note" label={t('folderNotes')} onClick={() => go({ name: 'notes', folder: path })} />
      </header>
      <div className="scroll">
        <div className="pad tight">
          <SessionLists open={state.tabs.filter((tab) => inside(tab.cwd, path))} stored={stored.data?.sessions} folder={path} onChange={stored.reload} />
        </div>
      </div>
      <div className="sticky-actions">
        <button className="button primary block" onClick={() => void startSession(path)}>
          <Icon name="plus" />
          {t('newSessionHere')}
        </button>
      </div>
    </section>
  )
}

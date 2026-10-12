import type { ReactNode } from 'react'
import type { TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { AccountPickSheet, accountName } from './accounts.tsx'
import { useTouch } from './context.tsx'
import { Icon, type IconName } from './icons.tsx'
import { NotesColumn } from './NotesTray.tsx'
import { IconButton, useQuery } from './parts.tsx'
import { pauseWords, QueueColumn, waitingQueue } from './queue.tsx'
import { useOpenTerminal } from './TerminalScreen.tsx'
import { useTrayDrag } from './trayDrag.ts'

// What the chat's Tools show in place of the conversation (the composer stays): the grid of tools, or one of them.
export type ToolsPage = 'grid' | 'notes' | 'queue'

// The Tools of a chat (the composer's Tools button): a grid of tiles. Note and Coda (with how many they hold) open their
// list of cards in the same place, ‹ goes back to the grid; File, Terminale, Torna indietro and Account open what the
// session menu used to (the folder's files, its terminal, the rewind, the account sheet).
// Parameters: the chat's meta, the page shown and onPage (another page).
export function ToolsView({ meta, page, onPage }: { meta: TabMeta; page: ToolsPage; onPage: (page: ToolsPage) => void }) {
  const { state, connection, announce, snack, fail, go, openSheet, toast } = useTouch()
  const openTerminal = useOpenTerminal()
  const tabId = meta.tabId
  const notes = useQuery(() => connection.request('notes.list', { cwd: meta.cwd }), [connection, meta.cwd, state.notesVersion[meta.cwd]])
  const queue = waitingQueue(meta)
  // The message counting down to go is the queue's first one, not shown: places in the list are one further.
  const offset = meta.queue.length - queue.length
  const noteIds = notes.data?.notes.map((note) => note.noteId) ?? []
  const drag = useTrayDrag({
    ids: { notes: page === 'notes' ? noteIds : [], queue: page === 'queue' ? queue.map((message) => message.queueId) : [] },
    onReorder: (list, ids, id) => {
      if (list === 'notes') return void connection.request('notes.reorder', { cwd: meta.cwd, noteIds: ids }).catch(fail)
      void connection.request('tab.queueMove', { tabId, queueId: id, index: ids.indexOf(id) + offset }).catch(fail)
    },
    onMove: () => undefined
  })
  // A note to the end of the queue; Restore brings it back where it was.
  const toQueue = (noteId: string) => {
    const place = noteIds.indexOf(noteId)
    connection
      .request('notes.toQueue', { tabId, noteId })
      .then(({ queueId }) => snack(t('noteQueued'), () => void connection.request('tab.queueToNote', { tabId, queueId, index: place }).catch(fail)), fail)
  }
  const paused = Boolean(meta.queuePause)
  const togglePause = () => connection.request('tab.queuePause', { tabId, paused: !paused }).then(() => announce(t(paused ? 'queueResumed' : 'queuePaused')), fail)

  const busy = meta.status === 'running' || meta.status === 'starting' || meta.status === 'requires_action'
  if (page === 'grid')
    return (
      <section className="tools-view" aria-label={t('tools')}>
        <ul className="tools-grid">
          <Tile icon="note" name={t('notes')} detail={notes.data ? notes.data.notes.length : ''} onClick={() => onPage('notes')} />
          <Tile icon="queue" name={t('queue')} detail={queue.length || t('queueEmptyShort')} onClick={() => onPage('queue')} />
          <Tile icon="folder" name={t('files')} onClick={() => go({ name: 'files', tabId })} />
          <Tile icon="prompt" name={t('terminal')} onClick={() => openTerminal({ tabId })} />
          <Tile icon="rewind" name={t('rewindShort')} detail={busy ? t('stopFirstShort') : ''} onClick={() => (busy ? toast(t('stopFirst')) : go({ name: 'rewind', tabId }))} />
          <Tile icon="person" name={t('account')} detail={accountName(state, meta.account)} onClick={() => openSheet({ title: t('account'), body: <AccountPickSheet tabId={tabId} /> })} />
        </ul>
      </section>
    )
  return (
    <section className="tools-view" aria-label={t(page === 'notes' ? 'notes' : 'queue')}>
      <div className="tools-head">
        <IconButton icon="back" label={t('allTools')} onClick={() => onPage('grid')} />
        <strong>{page === 'notes' ? t('notes') : t('queueTitle', { count: String(queue.length) })}</strong>
        {page === 'queue' && queue.length > 0 && (
          <button className="icon-btn q-play" aria-label={paused ? `${pauseWords(meta)}: ${t('resume')}` : t('pauseQueue')} onClick={() => void togglePause()}>
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
        )}
      </div>
      {page === 'notes' ? <NotesColumn tabId={tabId} cwd={meta.cwd} notes={notes.data?.notes} drag={drag} onToQueue={toQueue} /> : <QueueColumn meta={meta} drag={drag} />}
    </section>
  )
}

// One tile of the Tools grid: icon, name and a short detail (a count, a state). Parameters: those and onClick.
function Tile({ icon, name, detail, onClick }: { icon: IconName; name: string; detail?: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button className="tool-tile" onClick={onClick}>
        <Icon name={icon} />
        <span className="tool-name">{name}</span>
        <span className="tool-detail">{detail}</span>
      </button>
    </li>
  )
}

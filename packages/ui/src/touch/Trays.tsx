import type { TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { NotesColumn } from './NotesTray.tsx'
import { useQuery } from './parts.tsx'
import { QueueColumn, waitingQueue } from './queue.tsx'
import { useTrayDrag, type TrayList } from './trayDrag.ts'

// What hangs under the composer when opened: the folder's notes (Notes toggle) and the open queue (a tap on its
// stack), side by side when both are open. A card dragged from one column to the other moves there: a note joins the
// queue (and leaves the notes, with Restore), a queued message becomes a note (and leaves the queue).
// Parameters: the chat's meta, which columns are open, and onCloseQueue (the queue's ˅).
export function Trays({ meta, notesOpen, queueOpen, onCloseQueue }: { meta: TabMeta; notesOpen: boolean; queueOpen: boolean; onCloseQueue: () => void }) {
  const { state, connection, snack, fail } = useTouch()
  const tabId = meta.tabId
  const notes = useQuery(() => (notesOpen ? connection.request('notes.list', { cwd: meta.cwd }) : Promise.resolve(undefined)), [connection, meta.cwd, notesOpen, state.notesVersion[meta.cwd]])
  const queue = waitingQueue(meta)
  const queueShown = queueOpen && queue.length > 0
  // The message counting down to go is the queue's first one, not shown: places in the column are one further.
  const offset = meta.queue.length - queue.length
  const noteIds = notes.data?.notes.map((note) => note.noteId) ?? []
  // A note into the queue at a place (absent: the end); Restore brings it back where it was.
  const toQueue = (noteId: string, index?: number) => {
    const place = noteIds.indexOf(noteId)
    return connection
      .request('notes.toQueue', { tabId, noteId, ...(index === undefined ? {} : { index: index + offset }) })
      .then(({ queueId }) => snack(t('noteQueued'), () => void connection.request('tab.queueToNote', { tabId, queueId, index: place }).catch(fail)), fail)
  }
  const drag = useTrayDrag({
    ids: { notes: notesOpen ? noteIds : [], queue: queueShown ? queue.map((message) => message.queueId) : [] },
    onReorder: (list, ids, id) => {
      if (list === 'notes') return void connection.request('notes.reorder', { cwd: meta.cwd, noteIds: ids }).catch(fail)
      void connection.request('tab.queueMove', { tabId, queueId: id, index: ids.indexOf(id) + offset }).catch(fail)
    },
    onMove: (from: TrayList, id, _to, index) => {
      if (from === 'notes') return void toQueue(id, index)
      void connection.request('tab.queueToNote', { tabId, queueId: id, index }).catch(fail)
    }
  })
  if (!notesOpen && !queueShown) return null
  return (
    <div className={`trays${notesOpen && queueShown ? ' two' : ''}`}>
      {notesOpen && <NotesColumn tabId={tabId} cwd={meta.cwd} notes={notes.data?.notes} drag={drag} onToQueue={(noteId) => void toQueue(noteId)} />}
      {queueShown && <QueueColumn meta={meta} drag={drag} onClose={onCloseQueue} />}
    </div>
  )
}

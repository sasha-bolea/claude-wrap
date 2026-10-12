import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Note } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { IconButton, noteTitle, useQuery } from './parts.tsx'

// Saved this long after the last keystroke (and when leaving the card or the app).
const SAVE_DELAY = 600
// A press that moves farther than this (px) drags the card instead of opening it.
const DRAG_START = 5

// The notes of the session's folder as cards under the composer (its Notes toggle): the first card writes a new note,
// each other card is edited in place, deleted (top right, with undo), put into the message (bottom right) and dragged
// to another place (the order is the core's, the same on every device).
// tabId: the chat; cwd: its folder.
export function NotesTray({ tabId, cwd }: { tabId: string; cwd: string }) {
  const { state, connection, fail } = useTouch()
  const notes = useQuery(() => connection.request('notes.list', { cwd }), [connection, cwd, state.notesVersion[cwd]])
  // While a card is dragged (and until the core's list comes back in that order): the ids in their new order.
  const [order, setOrder] = useState<string[]>()
  const list = arrange(notes.data?.notes ?? [], order)
  const drag = useCardDrag(list, setOrder, (ids) => void connection.request('notes.reorder', { cwd, noteIds: ids }).catch(fail))
  useEffect(() => setOrder(undefined), [notes.data])
  return (
    <section className="notes-tray" aria-label={t('notes')}>
      <ul className="tray-list">
        <li>
          <NewNoteCard cwd={cwd} />
        </li>
        {list.map((note) => (
          <li key={note.noteId} ref={(element) => drag.register(note.noteId, element)} className={drag.dragged === note.noteId ? 'dragging' : undefined}>
            <TrayNote note={note} tabId={tabId} cwd={cwd} drag={drag.handlers(note.noteId)} wasDragged={drag.wasDragged} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// The notes in a given order (ids missing from it keep their place after the others). order: absent = as they are.
function arrange(notes: Note[], order: string[] | undefined): Note[] {
  if (!order) return notes
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...notes].sort((a, b) => (rank.get(a.noteId) ?? order.length) - (rank.get(b.noteId) ?? order.length))
}

// Drag to reorder the cards with a mouse or a finger: past DRAG_START px the pressed card follows the pointer, taking
// the place of the card under it; released, the new order is committed. A press without a drag is left to the click.
// Parameters: the cards in their order, setOrder (the live order) and commit (the final ids).
// Returns register (each card's element), handlers (for a card's grab area), the dragged id and wasDragged (true right
// after a drag, so its click is ignored).
function useCardDrag(list: Note[], setOrder: (ids: string[]) => void, commit: (ids: string[]) => void) {
  const elements = useRef(new Map<string, HTMLElement>())
  const press = useRef<{ id: string; y: number; moved: boolean }>(undefined)
  const ids = useRef<string[]>([])
  const justDragged = useRef(false)
  const [dragged, setDragged] = useState<string>()
  ids.current = list.map((note) => note.noteId)
  const register = (id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }
  // The card under a height of the screen (its own place when between two).
  const under = (y: number) => ids.current.find((id) => {
    const box = elements.current.get(id)?.getBoundingClientRect()
    return box !== undefined && y >= box.top && y <= box.bottom
  })
  const handlers = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      press.current = { id, y: event.clientY, moved: false }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current
      if (!current || current.id !== id) return
      if (!current.moved) {
        if (Math.abs(event.clientY - current.y) < DRAG_START) return
        current.moved = true
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragged(id)
      }
      const target = under(event.clientY)
      if (!target || target === id) return
      const next = ids.current.filter((other) => other !== id)
      next.splice(next.indexOf(target) + (ids.current.indexOf(target) > ids.current.indexOf(id) ? 1 : 0), 0, id)
      ids.current = next
      setOrder(next)
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = press.current
      press.current = undefined
      if (!current?.moved) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      justDragged.current = true
      setTimeout(() => (justDragged.current = false))
      setDragged(undefined)
      commit(ids.current)
    },
    onPointerCancel: () => {
      press.current = undefined
      setDragged(undefined)
    }
  })
  return { register, handlers, dragged, wasDragged: () => justDragged.current }
}

// The first card: an empty field reading "Nuova nota". Left with some text (or the app hidden), the text becomes a note
// on top of the others and the field empties. cwd: the folder.
function NewNoteCard({ cwd }: { cwd: string }) {
  const { connection, fail } = useTouch()
  const [text, setText] = useState('')
  const latest = useRef('')
  const keep = () => {
    const value = latest.current
    if (!value.trim()) return
    latest.current = ''
    setText('')
    connection.request('notes.save', { cwd, text: value }).catch((error: unknown) => {
      latest.current = value
      setText(value)
      fail(error)
    })
  }
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && keep()
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [])
  return (
    <div className="tray-note new">
      <textarea
        className="tray-note-field"
        rows={1}
        aria-label={t('newNote')}
        placeholder={t('newNote')}
        value={text}
        onChange={(event) => ((latest.current = event.target.value), setText(event.target.value))}
        onBlur={keep}
      />
    </div>
  )
}

// One note as a card: its text (a click edits it in place, a drag moves it), the bin top right, "Usa nel messaggio"
// bottom right. Edited, it is saved as you type and when you leave it; emptied, it goes away.
// Parameters: the note, the chat, the folder, the drag handlers of its text and wasDragged (a click right after a drag
// does not edit).
function TrayNote({ note, tabId, cwd, drag, wasDragged }: { note: Note; tabId: string; cwd: string; drag: ReturnType<ReturnType<typeof useCardDrag>['handlers']>; wasDragged: () => boolean }) {
  const { connection, snack, fail, insertInComposer } = useTouch()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const saved = useRef(note.text)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!editing) setText((saved.current = note.text))
  }, [note.text, editing])
  // Saves what is written (nothing when unchanged or empty).
  const save = (value: string) => {
    clearTimeout(timer.current)
    if (value === saved.current || !value.trim()) return
    saved.current = value
    connection.request('notes.save', { cwd, noteId: note.noteId, text: value }).catch(fail)
  }
  const change = (value: string) => {
    setText(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(value), SAVE_DELAY)
  }
  const leave = () => {
    setEditing(false)
    if (text.trim()) return save(text)
    clearTimeout(timer.current)
    connection.request('notes.delete', { cwd, noteId: note.noteId }).catch(fail)
  }
  const remove = () =>
    connection.request('notes.delete', { cwd, noteId: note.noteId }).then(() => snack(t('noteDeleted'), () => void connection.request('notes.save', { cwd, text: note.text }).catch(fail)), fail)
  return (
    <div className="tray-note">
      {editing ? (
        <textarea className="tray-note-field" aria-label={t('noteText')} autoFocus value={text} onChange={(event) => change(event.target.value)} onBlur={leave} onFocus={(event) => event.target.setSelectionRange(event.target.value.length, event.target.value.length)} />
      ) : (
        <button className="tray-note-text" aria-label={noteTitle(note.text)} {...drag} onClick={() => !wasDragged() && setEditing(true)}>
          <span>{note.text}</span>
        </button>
      )}
      <IconButton icon="trash" className="tray-note-delete" label={t('deleteNote')} onClick={() => void remove()} />
      <IconButton icon="to-chat" className="tray-note-send accent" label={t('useInMessage')} onClick={() => insertInComposer(tabId, { text: saved.current, noteId: note.noteId })} />
    </div>
  )
}

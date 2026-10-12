import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Note } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { IconButton, noteTitle } from './parts.tsx'
import type { TrayDrag, TrayList } from './trayDrag.ts'

// Saved this long after the last keystroke (and when leaving the card or the app).
const SAVE_DELAY = 600

// The notes of the session's folder as a list of cards (the Note tool): the first card writes a new note, each other
// card is edited in place, deleted (top right, with Restore), sent to the queue or put into the message (bottom right),
// and dragged by its handle to another place (the order is the core's, the same on every device).
// Parameters: the chat, its folder, the notes (absent while loading), the drag and onToQueue.
export function NotesColumn({ tabId, cwd, notes, drag, onToQueue }: { tabId: string; cwd: string; notes?: Note[]; drag: TrayDrag; onToQueue: (noteId: string) => void }) {
  const { connection, fail } = useTouch()
  const byId = new Map((notes ?? []).map((note) => [note.noteId, note]))
  const shown = drag.order('notes').flatMap((id) => byId.get(id) ?? [])
  return (
    <div className="tray notes-tray" ref={(element) => drag.registerColumn('notes', element)}>
      <ul className={`tray-list${drag.target?.list === 'notes' ? ' drop-target' : ''}`}>
        <li>
          <NewCard label={t('newNote')} saveLabel={t('saveNote')} onKeep={(text) => connection.request('notes.save', { cwd, text })} />
        </li>
        {shown.map((note, index) => (
          <TrayItem key={note.noteId} list="notes" id={note.noteId} index={index} drag={drag}>
            <TrayCard text={note.text} label={noteTitle(note.text)} fieldLabel={t('noteText')} list="notes" id={note.noteId} drag={drag} onSave={(text) => void connection.request('notes.save', { cwd, noteId: note.noteId, text }).catch(fail)} onEmptied={() => void connection.request('notes.delete', { cwd, noteId: note.noteId }).catch(fail)}>
              <NoteButtons note={note} tabId={tabId} cwd={cwd} onToQueue={onToQueue} />
            </TrayCard>
          </TrayItem>
        ))}
        {drag.target?.list === 'notes' && drag.target.index >= shown.length && <li className="drop-marker" aria-hidden="true" />}
      </ul>
    </div>
  )
}

// One card of a column: its row, with the drop marker before it while a card of the other column would land there,
// and the dragged look. Parameters: the column, the card's id and place, the drag, the card.
export function TrayItem({ list, id, index, drag, children }: { list: TrayList; id: string; index: number; drag: TrayDrag; children: ReactNode }) {
  return (
    <>
      {drag.target?.list === list && drag.target.index === index && <li className="drop-marker" aria-hidden="true" />}
      <li ref={(element) => drag.register(list, id, element)} className={drag.dragged?.list === list && drag.dragged.id === id ? 'dragging' : undefined}>
        {children}
      </li>
    </>
  )
}

// A card of the trays: the handle on its left edge (a drag there moves the card), its text (a click edits it in place)
// and its buttons. Edited, the text is saved as you type and when you leave it; left empty, onEmptied decides. Parameters: the text, the label of the card and of
// its field, where it is (list, id) for the drag, onSave, onEmptied and the buttons.
export function TrayCard({ text, label, fieldLabel, list, id, drag, onSave, onEmptied, className, children }: { text: string; label: string; fieldLabel: string; list: TrayList; id: string; drag: TrayDrag; onSave: (text: string) => void; onEmptied: () => void; className?: string; children: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  const saved = useRef(text)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!editing) setValue((saved.current = text))
  }, [text, editing])
  // Saves what is written (nothing when unchanged or empty).
  const save = (next: string) => {
    clearTimeout(timer.current)
    if (next === saved.current || !next.trim()) return
    saved.current = next
    onSave(next)
  }
  const change = (next: string) => {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(next), SAVE_DELAY)
  }
  const leave = () => {
    setEditing(false)
    if (value.trim()) return save(value)
    clearTimeout(timer.current)
    onEmptied()
  }
  return (
    <div className={`tray-note${className ? ` ${className}` : ''}`}>
      <button className="tray-handle" aria-label={t('dragToMove')} {...drag.handlers(list, id)}>
        <Icon name="grip" />
      </button>
      {editing ? (
        <textarea className="tray-note-field" aria-label={fieldLabel} autoFocus value={value} onChange={(event) => change(event.target.value)} onBlur={leave} onFocus={(event) => event.target.setSelectionRange(event.target.value.length, event.target.value.length)} />
      ) : (
        <button className="tray-note-text" aria-label={label} onClick={() => setEditing(true)}>
          <span>{text}</span>
        </button>
      )}
      {children}
    </div>
  )
}

// The first card of a list: an empty field with its placeholder (label). Its Save button (bottom right), or leaving it
// with some text (or the app hidden), hands the text to onKeep and empties the field (Save leaves the cursor there for
// the next one); a failure puts the text back. Parameters: label, saveLabel (the button's) and onKeep.
export function NewCard({ label, saveLabel, onKeep }: { label: string; saveLabel: string; onKeep: (text: string) => Promise<unknown> }) {
  const { fail } = useTouch()
  const [text, setText] = useState('')
  const latest = useRef('')
  const keep = () => {
    const value = latest.current
    if (!value.trim()) return
    latest.current = ''
    setText('')
    onKeep(value).catch((error: unknown) => {
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
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(event) => ((latest.current = event.target.value), setText(event.target.value))}
        onBlur={keep}
      />
      {/* Pressing it keeps the focus in the field: the text is kept by the click, not by the blur */}
      <button className="icon-btn tray-note-send accent" aria-label={saveLabel} disabled={!text.trim()} onMouseDown={(event) => event.preventDefault()} onClick={keep}>
        <Icon name="check" />
      </button>
    </div>
  )
}

// A note card's buttons: the bin top right (with Restore); bottom right "to the queue" and "Usa nel messaggio".
function NoteButtons({ note, tabId, cwd, onToQueue }: { note: Note; tabId: string; cwd: string; onToQueue: (noteId: string) => void }) {
  const { connection, snack, fail, insertInComposer } = useTouch()
  const remove = () =>
    connection.request('notes.delete', { cwd, noteId: note.noteId }).then(() => snack(t('noteDeleted'), () => void connection.request('notes.save', { cwd, text: note.text }).catch(fail)), fail)
  return (
    <>
      <IconButton icon="trash" className="tray-note-delete" label={t('deleteNote')} onClick={() => void remove()} />
      <IconButton icon="queue" className="tray-note-queue" label={t('toQueue')} onClick={() => onToQueue(note.noteId)} />
      <IconButton icon="to-chat" className="tray-note-send accent" label={t('useInMessage')} onClick={() => insertInComposer(tabId, { text: note.text, noteId: note.noteId })} />
    </>
  )
}

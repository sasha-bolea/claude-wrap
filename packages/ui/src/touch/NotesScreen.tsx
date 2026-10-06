import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { baseName } from './model.ts'
import { IconButton, noteTitle, Title, useQuery } from './parts.tsx'
import { useUndoReset } from './keyboard.ts'
import { when } from './sessions.tsx'

// Saved this long after the last keystroke (and when leaving the note or the app).
const SAVE_DELAY = 600

const noteRest = (text: string) => text.trim().split('\n').slice(1).join('\n')

// "Usa nel messaggio": the note's text into the chat's composer, linked to the draft until it is sent; back to the chat.
function useNoteInMessage(tabId?: string) {
  const { insertInComposer, backTo } = useTouch()
  return (note: { noteId: string; text: string }) => {
    if (!tabId) return
    insertInComposer(tabId, { text: note.text, noteId: note.noteId })
    backTo((screen) => screen.name === 'chat' && screen.tabId === tabId)
  }
}

// Notes of a session's folder (tabId) or of a Home folder (folder, no chat): the same on every device; search, open,
// use in the message (session only), a new one.
export function NotesScreen({ tabId, folder }: { tabId?: string; folder?: string }) {
  const { state, connection, back, go } = useTouch()
  const meta = tabId ? state.tabs.find((tab) => tab.tabId === tabId) : undefined
  const cwd = folder ?? meta?.cwd ?? ''
  const [needle, setNeedle] = useState('')
  const notes = useQuery(() => (cwd ? connection.request('notes.list', { cwd }) : Promise.resolve(undefined)), [connection, cwd, state.notesVersion[cwd]])
  const toMessage = useNoteInMessage(tabId)
  if (!folder && !meta) return null
  const search = needle.trim().toLowerCase()
  const list = (notes.data?.notes ?? []).filter((note) => note.text.toLowerCase().includes(search))
  // The new note's field takes the cursor within the tap, or iOS would not open the keyboard.
  const newNote = () => {
    flushSync(() => go({ name: 'note', tabId, folder }))
    ;[...document.querySelectorAll<HTMLTextAreaElement>('.note-editor')].at(-1)?.focus({ preventScroll: true })
  }
  return (
    <section className="screen" aria-label={t('folderNotes')}>
      <header className="topbar">
        <IconButton icon="back" label={t(folder ? 'back' : 'chat')} onClick={back} />
        <Title text={t('notes')} sub={baseName(cwd)} />
        <IconButton icon="plus" label={t('newNote')} onClick={newNote} />
      </header>
      <div className="scroll">
        <div className="pad tight">
          <input className="field" type="search" aria-label={t('searchNotes')} placeholder={t('searchNotes')} autoComplete="off" value={needle} onChange={(event) => setNeedle(event.target.value)} />
          <ul className="note-list">
            {list.map((note) => (
              <li key={note.noteId} className="note-card">
                <button className="note-open" onClick={() => go({ name: 'note', tabId, folder, noteId: note.noteId })}>
                  <strong>{noteTitle(note.text)}</strong>
                  {noteRest(note.text) && <span className="note-preview">{noteRest(note.text)}</span>}
                  <span className="note-date">{when(note.updatedAt)}</span>
                </button>
                {tabId && (
                  <div className="note-actions">
                    <button className="button" onClick={() => toMessage(note)}>
                      {t('useInMessage')}
                    </button>
                  </div>
                )}
              </li>
            ))}
            {notes.data && !list.length && <li className="muted empty-line">{t(search ? 'noNotesFound' : 'noNotes')}</li>}
          </ul>
        </div>
      </div>
    </section>
  )
}

// One note: saved as you type (and when you leave it or the app); emptied, it goes away. The trash deletes it (with
// undo); "Usa nel messaggio" saves it and takes it to the chat.
export function NoteScreen({ tabId, folder, noteId: opened }: { tabId?: string; folder?: string; noteId?: string }) {
  const { state, connection, back, snack, fail } = useTouch()
  const cwd = folder ?? state.tabs.find((tab) => tab.tabId === tabId)?.cwd ?? ''
  const [text, setText] = useState(opened ? undefined : '')
  const [savedAt, setSavedAt] = useState<number>()
  const noteId = useRef(opened)
  const saved = useRef('')
  const latest = useRef('')
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const gone = useRef(false)
  // An opened note counts only once loaded (leaving before that must not save or delete anything).
  const loaded = useRef(!opened)
  const toMessage = useNoteInMessage(tabId)
  const undoReset = useUndoReset()

  // Saves one after the other (a new note gets its id from the first save).
  const save = () => {
    clearTimeout(timer.current)
    const value = latest.current
    chain.current = chain.current.then(() => {
      if (!loaded.current || gone.current || value === saved.current || !value.trim()) return
      return connection.request('notes.save', { cwd, noteId: noteId.current, text: value }).then(({ note }) => {
        noteId.current = note.noteId
        saved.current = value
        setSavedAt(note.updatedAt)
      }, fail)
    })
    return chain.current
  }
  useEffect(() => {
    if (opened)
      connection.request('notes.list', { cwd }).then(({ notes }) => {
        const note = notes.find((candidate) => candidate.noteId === opened)
        saved.current = latest.current = note?.text ?? ''
        loaded.current = true
        setText(saved.current)
        setSavedAt(note?.updatedAt)
      }, fail)
    const hidden = () => document.visibilityState === 'hidden' && void save()
    document.addEventListener('visibilitychange', hidden)
    // Leaving the note: the last words saved; an emptied note deleted.
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      void save()
        .then(() => {
          if (loaded.current && !gone.current && !latest.current.trim() && noteId.current) return connection.request('notes.delete', { cwd, noteId: noteId.current })
        })
        .catch(() => undefined)
    }
  }, [])

  const change = (value: string) => {
    setText(value)
    latest.current = value
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), SAVE_DELAY)
  }
  const remove = () => {
    const value = latest.current
    void save().then(() => {
      gone.current = true
      const id = noteId.current
      if (!id) return
      return connection.request('notes.delete', { cwd, noteId: id }).then(() => snack(t('noteDeleted'), () => void connection.request('notes.save', { cwd, text: value }).catch(fail)), fail)
    })
    back()
  }
  const use = () => void save().then(() => noteId.current && toMessage({ noteId: noteId.current, text: saved.current }))
  const status = text === undefined ? t('loading') : savedAt ? t('savedAt', { when: when(savedAt) }) : t('newNote')

  return (
    <section className="screen" aria-label={t('note')}>
      <header className="topbar">
        <IconButton icon="back" label={t('notes')} onClick={back} />
        <Title text={t('note')} sub={status} />
        {tabId && <IconButton icon="to-chat" className="accent" label={t('useInMessage')} disabled={!text?.trim()} onClick={use} />}
        <IconButton icon="trash" label={t('deleteNote')} onClick={remove} />
      </header>
      <textarea key={undoReset} className="note-editor" aria-label={t('noteText')} placeholder={t('writeNote')} value={text ?? ''} disabled={text === undefined} onChange={(event) => change(event.target.value)} />
    </section>
  )
}

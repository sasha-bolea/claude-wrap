import { randomUUID } from 'node:crypto'
import type { Note } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

type Notes = Record<string, Note[]>

// The notes of every folder (key: the canonical folder) in <stateDir>/notes.json; memory only without a state folder.
export class NoteStore {
  private readonly file?: JsonFile<Notes>
  private data?: Promise<Notes>

  constructor(file?: string) {
    this.file = file ? new JsonFile(file) : undefined
  }

  // Notes of a folder, newest first (by last change).
  async list(cwd: string): Promise<Note[]> {
    return [...((await this.load())[cwd] ?? [])].reverse().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // Creates a note (noteId absent) or changes one. Returns it.
  async save(cwd: string, noteId: string | undefined, text: string): Promise<Note> {
    const data = await this.load()
    const notes = (data[cwd] ??= [])
    const now = Date.now()
    let note = noteId ? notes.find((existing) => existing.noteId === noteId) : undefined
    if (noteId && !note) throw new CoreError('not_found', 'note not found')
    if (note) Object.assign(note, { text, updatedAt: now })
    else notes.push((note = { noteId: randomUUID(), text, createdAt: now, updatedAt: now }))
    await this.file?.save(data)
    return note
  }

  async delete(cwd: string, noteId: string): Promise<void> {
    const data = await this.load()
    const notes = data[cwd] ?? []
    if (!notes.some((note) => note.noteId === noteId)) throw new CoreError('not_found', 'note not found')
    data[cwd] = notes.filter((note) => note.noteId !== noteId)
    await this.file?.save(data)
  }

  // Reads the file once.
  private load(): Promise<Notes> {
    this.data ??= this.file ? this.file.read().then((read) => read ?? {}) : Promise.resolve({})
    return this.data
  }
}

import { randomUUID } from 'node:crypto'
import type { Note } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

// rank: the note's place in its folder (lowest first); absent in files from before the order was kept.
type StoredNote = Note & { rank?: number }
type Notes = Record<string, StoredNote[]>

// The notes of every folder (key: the canonical folder) in <stateDir>/notes.json; memory only without a state folder.
export class NoteStore {
  private readonly file?: JsonFile<Notes>
  private data?: Promise<Notes>

  constructor(file?: string) {
    this.file = file ? new JsonFile(file) : undefined
  }

  // Notes of a folder in their order. Notes without a place (an older file) get one first: newest change first, as
  // they were listed, after the ones that have it.
  async list(cwd: string): Promise<Note[]> {
    const data = await this.load()
    const notes = data[cwd] ?? []
    if (notes.some((note) => note.rank === undefined)) {
      const ranked = notes.filter((note) => note.rank !== undefined).sort((a, b) => a.rank! - b.rank!)
      const unranked = notes.filter((note) => note.rank === undefined).sort((a, b) => b.updatedAt - a.updatedAt)
      data[cwd] = [...ranked, ...unranked].map((note, index) => ({ ...note, rank: index }))
      await this.file?.save(data)
    }
    return [...(data[cwd] ?? [])].sort((a, b) => a.rank! - b.rank!).map(({ rank: _rank, ...note }) => note)
  }

  // Puts a note at a place of its folder's order (clamped to the end); the others keep their order.
  async place(cwd: string, noteId: string, index: number): Promise<void> {
    const ids = (await this.list(cwd)).map((note) => note.noteId).filter((id) => id !== noteId)
    ids.splice(Math.min(index, ids.length), 0, noteId)
    await this.reorder(cwd, ids)
  }

  // A new order: the ids given first, in that order (unknown ones ignored), then the others in their order.
  async reorder(cwd: string, noteIds: string[]): Promise<void> {
    const listed = await this.list(cwd)
    const first = noteIds.filter((id) => listed.some((note) => note.noteId === id))
    const order = [...new Set([...first, ...listed.map((note) => note.noteId)])]
    const data = await this.load()
    for (const note of data[cwd] ?? []) note.rank = order.indexOf(note.noteId)
    await this.file?.save(data)
  }

  // Creates a note (noteId absent) or changes one. Returns it.
  async save(cwd: string, noteId: string | undefined, text: string): Promise<Note> {
    const data = await this.load()
    const notes = (data[cwd] ??= [])
    const now = Date.now()
    let note = noteId ? notes.find((existing) => existing.noteId === noteId) : undefined
    if (noteId && !note) throw new CoreError('not_found', 'note not found')
    if (note) Object.assign(note, { text, updatedAt: now })
    else notes.push((note = { noteId: randomUUID(), text, createdAt: now, updatedAt: now, rank: Math.min(0, ...notes.map((other) => other.rank ?? 0)) - 1 }))
    await this.file?.save(data)
    const { rank: _rank, ...saved } = note
    return saved
  }

  async delete(cwd: string, noteId: string): Promise<void> {
    const data = await this.load()
    const notes = data[cwd] ?? []
    if (!notes.some((note) => note.noteId === noteId)) throw new CoreError('not_found', 'note not found')
    data[cwd] = notes.filter((note) => note.noteId !== noteId)
    await this.file?.save(data)
  }

  // A folder moved: its notes, and those of the folders inside it, go with it (merged with any already there).
  // rebase: where a folder's notes go (the same path for folders outside the move).
  async rebase(rebase: (cwd: string) => string): Promise<void> {
    const data = await this.load()
    let moved = false
    for (const [cwd, notes] of Object.entries(data)) {
      const target = rebase(cwd)
      if (target === cwd) continue
      data[target] = [...(data[target] ?? []), ...notes]
      delete data[cwd]
      moved = true
    }
    if (moved) await this.file?.save(data)
  }

  // Reads the file once.
  private load(): Promise<Notes> {
    this.data ??= this.file ? this.file.read().then((read) => read ?? {}) : Promise.resolve({})
    return this.data
  }
}

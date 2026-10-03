import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TrashItem } from '@claude-wrap/protocol'
import { CoreError } from './errors.ts'
import { withinRoots } from './trustGate.ts'

// How long the app's trash keeps what was deleted.
export const TRASH_DAYS = 7
const DAY_MS = 24 * 3600 * 1000

// What the trash knows of an item: where it was, what it was, when it went, and the project marks of the folders it
// held (relative to it, '' = the item itself), which come back with it.
export type TrashEntry = { path: string; kind: 'file' | 'folder'; deletedAt: number; projects: string[] }

const exists = (path: string) => stat(path).then(() => true, () => false)

// Renames, or copies and removes when source and target are on different disks.
export async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await rm(from, { recursive: true, force: true })
  }
}

// The app's trash of the remote server (the desktop uses the system's): one folder per item under dir, holding the
// item and its meta.json. now: the clock (tests move it).
export class Trash {
  private readonly dir: string
  private readonly now: () => number

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir
    this.now = now
  }

  // Moves a file or folder into the trash. projects: marks inside it (relative paths) to restore with it.
  async put(path: string, projects: string[] = []): Promise<void> {
    const info = await stat(path)
    const deletedAt = this.now()
    const folder = join(this.dir, `${deletedAt}-${randomUUID().slice(0, 8)}`)
    await mkdir(folder, { recursive: true })
    const entry: TrashEntry = { path, kind: info.isDirectory() ? 'folder' : 'file', deletedAt, projects }
    await writeFile(join(folder, 'meta.json'), JSON.stringify(entry))
    await move(path, join(folder, 'item'))
  }

  // Items, newest first. under: only what was inside that folder.
  async list(under?: string): Promise<TrashItem[]> {
    const items = (await this.entries()).filter(({ entry }) => !under || withinRoots(entry.path, [under]))
    return items
      .sort((a, b) => b.entry.deletedAt - a.entry.deletedAt || b.id.localeCompare(a.id))
      .map(({ id, entry }) => ({ id, path: entry.path, kind: entry.kind, deletedAt: entry.deletedAt, expiresAt: entry.deletedAt + TRASH_DAYS * DAY_MS }))
  }

  // Puts an item back where it was; refused when that place is taken. Returns what it was (path, project marks).
  async restore(id: string): Promise<TrashEntry> {
    const entry = await this.entry(id)
    if (await exists(entry.path)) throw new CoreError('invalid_args', `something is already at ${entry.path}`)
    await mkdir(dirname(entry.path), { recursive: true })
    await move(join(this.dir, id, 'item'), entry.path)
    await rm(join(this.dir, id), { recursive: true, force: true })
    return entry
  }

  // Deletes an item for good.
  async delete(id: string): Promise<void> {
    await this.entry(id)
    await rm(join(this.dir, id), { recursive: true, force: true })
  }

  // Deletes for good everything (under: only what was inside that folder).
  async empty(under?: string): Promise<void> {
    for (const item of await this.list(under)) await this.delete(item.id)
  }

  // Forgets what is older than TRASH_DAYS, and folders left without their meta.json.
  async expire(): Promise<void> {
    const limit = this.now() - TRASH_DAYS * DAY_MS
    const names = await readdir(this.dir).catch(() => [])
    for (const id of names) {
      const entry = await this.entry(id).catch(() => undefined)
      if (!entry || entry.deletedAt < limit) await rm(join(this.dir, id), { recursive: true, force: true })
    }
  }

  // Every readable item with its id.
  private async entries(): Promise<{ id: string; entry: TrashEntry }[]> {
    const names = await readdir(this.dir).catch(() => [])
    const read = await Promise.all(names.map(async (id) => ({ id, entry: await this.entry(id).catch(() => undefined) })))
    return read.filter((item): item is { id: string; entry: TrashEntry } => item.entry !== undefined)
  }

  // The meta of an item, or not_found.
  private async entry(id: string): Promise<TrashEntry> {
    if (!/^[\w-]+$/.test(id)) throw new CoreError('not_found', 'not in the trash')
    try {
      return JSON.parse(await readFile(join(this.dir, id, 'meta.json'), 'utf8')) as TrashEntry
    } catch {
      throw new CoreError('not_found', 'not in the trash')
    }
  }
}

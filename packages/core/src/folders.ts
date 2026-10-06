import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CommandResult } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { canonicalFolder, checkRoots, withinRoots } from './trustGate.ts'

// Folders of the Home and of the folder picker: list and create, always inside the backend's allowed roots (paths
// canonicalized first, symlinks resolved on Linux). Symlinked folders are not listed.

// Subfolders of a folder (hidden ones skipped) with their project mark, its parent while that is still inside the
// roots, and how many files are right inside it (hidden ones among them; .git apart). path absent: the first root (or
// the home folder when any folder is allowed).
export async function listFolders(path: string | undefined, roots: 'any' | string[], projects: Set<string>): Promise<CommandResult<'folders.list'>> {
  const folder = await canonicalFolder(path ?? (roots === 'any' ? homedir() : roots[0]!))
  checkRoots(folder, roots)
  const entries = await readdir(folder, { withFileTypes: true })
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: join(folder, name), project: projects.has(join(folder, name)) }))
  const files = entries.filter((entry) => !entry.isDirectory() && entry.name.toLowerCase() !== '.git')
  const up = dirname(folder)
  return { path: folder, parent: up !== folder && withinRoots(up, roots) ? up : undefined, folders, files: { count: files.length, hidden: files.filter((entry) => entry.name.startsWith('.')).length } }
}

// Creates a folder (name already validated by the protocol schema) inside an allowed folder.
export async function createFolder(path: string, name: string, roots: 'any' | string[]): Promise<CommandResult<'folders.create'>> {
  const parent = await canonicalFolder(path)
  checkRoots(parent, roots)
  const target = join(parent, name)
  await mkdir(target).catch((error: NodeJS.ErrnoException) => {
    throw new CoreError('invalid_args', error.code === 'EEXIST' ? `already exists: ${target}` : error.message)
  })
  return { path: target }
}

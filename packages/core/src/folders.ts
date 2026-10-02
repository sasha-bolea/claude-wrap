import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CommandResult } from '@claude-wrap/protocol'
import { CoreError } from './errors.ts'
import { canonicalFolder, checkRoots, withinRoots } from './trustGate.ts'

// The folder picker of clients without a native dialog (the PWA on the remote server): list and create
// folders, always inside the backend's allowed roots (paths canonicalized first, symlinks resolved on Linux).

// Subfolders of a folder (hidden ones skipped), and its parent while that is still inside the roots.
// path absent: the first root (or the home folder when any folder is allowed).
export async function browseFolders(path: string | undefined, roots: 'any' | string[]): Promise<CommandResult<'fs.browse'>> {
  const folder = await canonicalFolder(path ?? (roots === 'any' ? homedir() : roots[0]!))
  checkRoots(folder, roots)
  const entries = await readdir(folder, { withFileTypes: true })
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const up = dirname(folder)
  return { path: folder, parent: up !== folder && withinRoots(up, roots) ? up : undefined, folders }
}

// Creates a folder (name already validated by the protocol schema) inside an allowed folder.
export async function makeFolder(path: string, name: string, roots: 'any' | string[]): Promise<CommandResult<'fs.mkdir'>> {
  const parent = await canonicalFolder(path)
  checkRoots(parent, roots)
  const target = join(parent, name)
  await mkdir(target).catch((error: NodeJS.ErrnoException) => {
    throw new CoreError('invalid_args', error.code === 'EEXIST' ? `already exists: ${target}` : error.message)
  })
  return { path: target }
}

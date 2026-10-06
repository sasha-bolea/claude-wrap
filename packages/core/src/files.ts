import { lstat, mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { LIMITS, type CommandResult, type FileEntry } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { move } from './trash.ts'
import { findGitRoot } from './trust.ts'

// File explorer of a session's folder (already canonical and trusted: Tab.folder()). Every path from a client is
// relative to the folder and is refused when it is absolute, climbs with `..`, enters `.git`, or — symlinks
// resolved — ends outside the folder.

// Folder of a session where the non-photo attachments of messages go (excluded from git on this machine only).
export const ATTACHMENTS = 'allegati'
const MEDIA_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
}

const exists = (path: string) => stat(path).then(() => true, () => false)
const isText = (mediaType: string) => mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'image/svg+xml'

// True when path is folder itself or lies inside it.
function inside(folder: string, path: string): boolean {
  const rel = relative(folder, path)
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel))
}

// realpath, with not_found for a missing path.
async function realOf(path: string): Promise<string> {
  return realpath(path).catch(() => {
    throw new CoreError('not_found', `not found: ${path}`)
  })
}

// How a client path is resolved: 'target' (read, list: symlinks followed, must exist), 'create' (write, new folder,
// move target: only its folder must exist; a name already there — even a broken symlink — is followed whole, so a
// write never goes through a link out of the folder), 'entry' (delete, move source: the entry itself, a symlink
// included, not what it points to).
type Resolve = 'target' | 'create' | 'entry'

// The absolute path of a client path relative to folder (rules above), its folders' symlinks resolved.
export async function resolveInside(folder: string, path: string, mode: Resolve = 'target'): Promise<string> {
  const parts = path.split(/[\\/]/).filter((part) => part && part !== '.')
  if (isAbsolute(path) || parts.includes('..')) throw new CoreError('outside_root', `outside the session folder: ${path}`)
  if (parts.some((part) => part.toLowerCase() === '.git')) throw new CoreError('invalid_args', '.git is protected')
  const root = await realpath(folder)
  const target = join(root, ...parts)
  const present = await lstat(target).then(() => true, () => false)
  if (mode !== 'create' && !present) throw new CoreError('not_found', `not found: ${path}`)
  const followed = mode === 'target' || (mode === 'create' && present)
  const real = followed ? await realOf(target) : join(await realOf(dirname(target)), basename(target))
  if (!inside(root, real)) throw new CoreError('outside_root', `outside the session folder: ${path}`)
  return real
}

// The client path of an absolute path inside folder ('/'-separated).
async function relativeTo(folder: string, path: string): Promise<string> {
  return relative(await realpath(folder), path).split(sep).join('/')
}

// Entries of a folder: folders first, then files, by name; `.git` hidden.
export async function listFiles(folder: string, path: string): Promise<FileEntry[]> {
  const dir = await resolveInside(folder, path)
  if (!(await stat(dir)).isDirectory()) throw new CoreError('invalid_args', `not a folder: ${path}`)
  const names = (await readdir(dir)).filter((name) => name.toLowerCase() !== '.git')
  const entries = await Promise.all(
    names.map(async (name): Promise<FileEntry | undefined> => {
      const info = await stat(join(dir, name)).catch(() => undefined)
      if (!info) return undefined
      return { name, kind: info.isDirectory() ? 'folder' : 'file', size: info.isDirectory() ? 0 : info.size, modified: Math.round(info.mtimeMs) }
    })
  )
  return entries
    .filter((entry): entry is FileEntry => entry !== undefined)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1))
}

// The first length bytes of a file.
async function readStart(file: string, length: number): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

// A file for the preview (text as utf8, images as base64, other binaries without data; at most previewBytes,
// `truncated` beyond) or for a download (base64, the whole file, at most fileBytes).
export async function readFileFor(folder: string, path: string, download = false): Promise<CommandResult<'files.read'>> {
  const file = await resolveInside(folder, path)
  const { size, isDirectory } = await stat(file).then((info) => ({ size: info.size, isDirectory: info.isDirectory() }))
  if (isDirectory) throw new CoreError('invalid_args', `a folder, not a file: ${path}`)
  const limit = download ? LIMITS.fileBytes : LIMITS.previewBytes
  if (download && size > limit) throw new CoreError('too_large', `larger than ${limit} bytes`)
  const bytes = await readStart(file, Math.min(size, limit))
  const textual = !bytes.subarray(0, 8000).includes(0)
  const mediaType = MEDIA_TYPES[extname(file).toLowerCase()] ?? (textual ? 'text/plain' : 'application/octet-stream')
  const truncated = size > limit
  if (download) return { mediaType, encoding: 'base64', data: bytes.toString('base64'), size, truncated: false }
  if (isText(mediaType)) return { mediaType, encoding: 'utf8', data: bytes.toString('utf8'), size, truncated }
  const data = mediaType.startsWith('image/') && !truncated ? bytes.toString('base64') : ''
  return { mediaType, encoding: 'base64', data, size, truncated }
}

// Adds allegati/ to the repository's .git/info/exclude (local only, never committed), once. Nothing to do outside a
// repository, or in a worktree (its .git is a file).
async function excludeFromGit(folder: string): Promise<void> {
  const repo = await findGitRoot(folder)
  if (!repo || !(await stat(join(repo, '.git')).then((info) => info.isDirectory(), () => false))) return
  const file = join(repo, '.git', 'info', 'exclude')
  const current = await readFile(file, 'utf8').catch(() => '')
  if (current.split(/\r?\n/).includes(`${ATTACHMENTS}/`)) return
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${ATTACHMENTS}/\n`)
}

// Saves an attachment under allegati/ with a free name ("name (2).ext"…). Returns the path to mention.
async function saveAttachment(folder: string, name: string, bytes: Buffer): Promise<string> {
  if (/[\\/]/.test(name) || name === '.' || name === '..') throw new CoreError('invalid_args', `an attachment needs a plain file name: ${name}`)
  const root = await realpath(folder)
  await mkdir(join(root, ATTACHMENTS), { recursive: true })
  // allegati/ itself might be a link out of the folder.
  const dir = await resolveInside(folder, ATTACHMENTS)
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  for (let copy = 1; ; copy++) {
    const file = copy === 1 ? name : `${stem} (${copy})${extension}`
    try {
      await writeFile(join(dir, file), bytes, { flag: 'wx' })
      await excludeFromGit(root)
      return `${ATTACHMENTS}/${file}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

// Writes an uploaded file (base64 data). Refuses to replace a file unless overwrite; attachment: see saveAttachment.
// Returns the path written, relative to folder.
export async function writeFileFor(folder: string, path: string, data: string, options: { overwrite?: boolean; attachment?: boolean } = {}): Promise<string> {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > LIMITS.fileBytes) throw new CoreError('too_large', `larger than ${LIMITS.fileBytes} bytes`)
  if (options.attachment) return saveAttachment(folder, path, bytes)
  const target = await resolveInside(folder, path, 'create')
  if (!options.overwrite && (await exists(target))) throw new CoreError('invalid_args', `already exists: ${path}`)
  await writeFile(target, bytes)
  return relativeTo(folder, target)
}

// Creates a folder.
export async function makeDir(folder: string, path: string): Promise<void> {
  const target = await resolveInside(folder, path, 'create')
  await mkdir(target).catch((error: NodeJS.ErrnoException) => {
    throw new CoreError('invalid_args', error.code === 'EEXIST' ? `already exists: ${path}` : error.message)
  })
}

// Renames or moves a file or folder inside folder; refused when the target exists.
export async function moveFile(folder: string, from: string, to: string): Promise<void> {
  const source = await deletable(folder, from)
  const target = await resolveInside(folder, to, 'create')
  if (await exists(target)) throw new CoreError('invalid_args', `already exists: ${to}`)
  await move(source, target)
}

// The absolute path of something that may be deleted or moved: anything inside folder but the folder itself.
export async function deletable(folder: string, path: string): Promise<string> {
  const target = await resolveInside(folder, path, 'entry')
  if (target === (await realpath(folder))) throw new CoreError('invalid_args', 'not the session folder itself')
  return target
}

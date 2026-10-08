import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { MEMORY_LIMITS } from '@athome/protocol'
import { CoreError } from './errors.ts'
import type { MemoryPaths } from './inspect.ts'
import { serialized, writeThrough } from './settingsFiles.ts'

// The files of the Memory panel (as /memory): only paths the CLI's memory dialog lists can be read; instruction files
// can be written (at the version the client read, so an edit made meanwhile elsewhere is never overwritten), saved
// memories deleted. The index of the memories is MEMORY.md, next to them.

const INDEX = 'MEMORY.md'

// What a listed path is: an instruction file or a saved memory. outside_root when the dialog does not list it.
export function listedAs(paths: MemoryPaths, path: string): 'file' | 'memory' {
  const wanted = resolve(path)
  if (paths.files.some((file) => resolve(file) === wanted)) return 'file'
  if (paths.memories.some((memory) => resolve(memory) === wanted)) return 'memory'
  throw new CoreError('outside_root', `not a file of the memory panel: ${path}`)
}

// A file's version: its modification time and size ('' when it does not exist).
async function versionOf(file: string): Promise<string> {
  const info = await stat(file).catch(() => undefined)
  return info ? `${info.mtimeMs}:${info.size}` : ''
}

// Reads a listed file. Returns its text (empty for a file not created yet), whether it exists and its version;
// too_large over MEMORY_LIMITS.textBytes.
export async function readMemoryFile(file: string): Promise<{ text: string; exists: boolean; version: string }> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return { text: '', exists: false, version: '' }
  if (!info.isFile()) throw new CoreError('invalid_args', `not a file: ${file}`)
  if (info.size > MEMORY_LIMITS.textBytes) throw new CoreError('too_large', `larger than ${MEMORY_LIMITS.textBytes} bytes`)
  return { text: await readFile(file, 'utf8'), exists: true, version: `${info.mtimeMs}:${info.size}` }
}

// Saves an instruction file if it is still at `version` (invalid_args when it changed meanwhile: reopen it). Returns
// the new version.
export function writeMemoryFile(file: string, text: string, version: string): Promise<string> {
  return serialized(file, async () => {
    if ((await versionOf(file)) !== version) throw new CoreError('invalid_args', 'the file changed meanwhile: reopen it')
    await writeThrough(file, text)
    return versionOf(file)
  })
}

// Takes the lines that link a memory out of the MEMORY.md next to it (nothing when there is no index).
export async function unindexMemory(file: string): Promise<void> {
  const index = join(dirname(file), INDEX)
  const link = `](${basename(file)})`
  await serialized(index, async () => {
    const text = await readFile(index, 'utf8').catch(() => undefined)
    if (text === undefined) return
    const kept = text.split('\n').filter((line) => !line.includes(link))
    if (kept.length !== text.split('\n').length) await writeThrough(index, kept.join('\n'))
  })
}

// Whether a memory path is the index itself (never deleted from the app).
export function isIndex(file: string): boolean {
  return basename(file) === INDEX
}

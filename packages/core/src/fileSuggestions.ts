import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

// Files and folders for `@` mentions: `git ls-files` (tracked + untracked, .gitignore honoured) in a git folder,
// else a bounded walk that skips dependency and build folders. Callers check the folder is trusted first.

const run = promisify(execFile)
const MAX_FILES = 20_000
const CACHE_MS = 10_000
const RESULTS = 15
const SKIPPED = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', 'target', '__pycache__', '.venv', 'venv'])

const cache = new Map<string, { at: number; paths: string[] }>()

// Paths relative to cwd, with `/` separators; undefined outside a git work tree.
// core.fsmonitor is forced off: a repo's config must not run a command just because we list its files.
async function gitFiles(cwd: string): Promise<string[] | undefined> {
  const args = ['-c', 'core.fsmonitor=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']
  const result = await run('git', args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).catch(() => undefined)
  return result?.stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)
}

// Breadth-first walk, at most MAX_FILES files.
async function walkFiles(cwd: string): Promise<string[]> {
  const files: string[] = []
  const folders = ['']
  while (folders.length && files.length < MAX_FILES) {
    const folder = folders.shift()!
    const entries = await readdir(join(cwd, folder), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) folders.push(path)
      } else files.push(path)
    }
  }
  return files.slice(0, MAX_FILES)
}

// Files plus their parent folders (with a trailing `/`), cached for a few seconds per folder (one query per keystroke).
async function listPaths(cwd: string): Promise<string[]> {
  const cached = cache.get(cwd)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.paths
  const files = (await gitFiles(cwd)) ?? (await walkFiles(cwd))
  const folders = new Set<string>()
  for (const file of files) {
    for (let end = file.indexOf('/'); end > 0; end = file.indexOf('/', end + 1)) folders.add(file.slice(0, end + 1))
  }
  const paths = [...folders, ...files]
  cache.set(cwd, { at: Date.now(), paths })
  return paths
}

// True if the query's characters appear in the path in order (fuzzy fallback).
function inOrder(path: string, query: string): boolean {
  let position = 0
  for (const char of path) if (char === query[position]) position++
  return position === query.length
}

// Rank of a path for a query (lower is better), or -1 when it does not match: name starts with it, name
// contains it, path contains it, characters in order.
function rank(path: string, query: string): number {
  const lower = path.toLowerCase()
  const name = basename(lower.replace(/\/$/, ''))
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (lower.includes(query)) return 2
  return inOrder(lower, query) ? 3 : -1
}

// The best matches for a query in a folder; an empty query gives the shortest paths.
export async function suggestFiles(cwd: string, query: string): Promise<string[]> {
  const needle = query.toLowerCase().replaceAll('\\', '/')
  return (await listPaths(cwd))
    .map((path) => ({ path, score: rank(path, needle) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
    .slice(0, RESULTS)
    .map(({ path }) => path)
}

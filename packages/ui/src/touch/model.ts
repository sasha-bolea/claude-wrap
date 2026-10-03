import { createElement, type ReactNode } from 'react'
import type { FileEntry, TabMeta } from '@claude-wrap/protocol'

// Pure helpers of the touch layout (tested in model.test.ts).

// What a session is doing, as its badge shows it: waiting for you, working, stopped with an error, or idle.
export type SessionState = 'waiting' | 'working' | 'error' | 'idle'
const URGENCY: SessionState[] = ['waiting', 'error', 'working', 'idle']

export function sessionState(tab: TabMeta): SessionState {
  if (tab.status === 'requires_action') return 'waiting'
  if (tab.status === 'running' || tab.status === 'starting') return 'working'
  if (tab.status === 'error') return 'error'
  return 'idle'
}

// A path for comparisons: '/' separators, no trailing one, and lower case for Windows paths (case-insensitive).
function comparable(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed
}

// True when path is folder itself or lies below it.
export function inside(path: string, folder: string): boolean {
  const target = comparable(path)
  const base = comparable(folder)
  return target === base || target.startsWith(`${base}/`)
}

// The open sessions inside a folder: how many, and the most urgent state among them ('idle' when none).
export function folderSummary(tabs: TabMeta[], folder: string): { open: number; state: SessionState } {
  const states = tabs.filter((tab) => inside(tab.cwd, folder)).map(sessionState)
  return { open: states.length, state: URGENCY.find((state) => states.includes(state)) ?? 'idle' }
}

// The last part of a path (a folder's name).
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

// Short name of a model id as the CLI reports it ("claude-opus-5-5" → "Opus 5.5"); other ids stay as they are.
export function modelShortName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family![0]!.toUpperCase()}${family!.slice(1)} ${minor ? `${major}.${minor}` : major}`
}

// A file size for a row ("820 KB", "1.2 MB", in the language's number format).
export const sizeLabel = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`)

// A name not taken yet ("image (2).jpg"…), added to taken: photos from the iPhone all come as image.jpg.
export function freeName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = name
  for (let copy = 2; taken.has(candidate); copy++) candidate = `${stem} (${copy})${extension}`
  taken.add(candidate)
  return candidate
}

// What changed in a folder between two listings (the end of a turn): names created, files modified.
export function filesChanged(before: FileEntry[], after: FileEntry[]): { created: string[]; modified: string[] } {
  const old = new Map(before.map((entry) => [entry.name, entry]))
  const created = after.filter((entry) => !old.has(entry.name)).map((entry) => entry.name)
  const modified = after
    .filter((entry) => {
      const was = old.get(entry.name)
      return was && entry.kind === 'file' && (was.modified !== entry.modified || was.size !== entry.size)
    })
    .map((entry) => entry.name)
  return { created, modified }
}

// Highlighted HTML (text already escaped) split into lines: the spans open at the end of a line are closed there and
// opened again on the next one.
export function htmlLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let line = ''
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      lines.push(line + '</span>'.repeat(open.length))
      line = open.join('')
      continue
    }
    if (part.startsWith('<span')) open.push(part)
    else if (part === '</span>') open.pop()
    line += part
  }
  lines.push(line)
  return lines
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }

// One line of highlighted HTML (only <span class="…"> tags and escaped text, as highlight.js writes it) as React
// nodes: the file's text never becomes HTML (design rule 10). Anything else stays visible as plain text.
export function spanNodes(html: string): ReactNode[] {
  const root: ReactNode[] = []
  const open: { className: string; children: ReactNode[] }[] = []
  const add = (node: ReactNode) => (open.at(-1)?.children ?? root).push(node)
  let key = 0
  for (const part of html.split(/(<span class="[^"<>]*">|<\/span>)/)) {
    const tag = /^<span class="([^"<>]*)">$/.exec(part)
    if (tag) open.push({ className: tag[1]!, children: [] })
    else if (part === '</span>' && open.length) {
      const span = open.pop()!
      add(createElement('span', { key: key++, className: span.className }, ...span.children))
    } else if (part) add(part.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name: string) => ENTITIES[name]!))
  }
  return root
}

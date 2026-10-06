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

// Tokens for a panel ("850", "48.5k", "1.2M", in the language's number format).
export function tokenLabel(tokens: number, locale?: string): string {
  const short = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 })
  return tokens >= 1e6 ? `${short(tokens / 1e6)}M` : tokens >= 1e3 ? `${short(tokens / 1e3)}k` : String(Math.round(tokens))
}

// A duration for a panel: "45 s", "1 min 35 s", "2 h 5 min".
export function durationLabel(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 60)} h`
}

// When a usage window resets: the time if it is today, else day and time ("22:00", "Thu 8 Oct, 11:00").
export function resetLabel(iso: string, now = new Date(), locale?: string): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  return `${at.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}

// An amount in dollars, as the CLI reports costs ("$0.42").
export const usdLabel = (usd: number, locale?: string) => usd.toLocaleString(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: usd < 1 ? 3 : 2 })

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

// One question of a form Claude asked, with the answer given (undefined: not answered, or the form skipped).
export type AnsweredQuestion = { header: string; question: string; answer?: string }

// Endings the CLI puts after the "question"="answer" pairs of an AskUserQuestion result.
const ANSWERS_END = ['. You can now continue with these answers in mind.', '. Read the answers carefully']

// The questions of an AskUserQuestion call with the answers found in its result, which the CLI writes as
// `"question"="answer"` pairs (live and in a resumed session alike: only the text survives in the transcript).
// Params: the call's input and its result text. Returns the questions in order; [] when the input has none.
export function answeredQuestions(input: unknown, result: string): AnsweredQuestion[] {
  const raw = (input as { questions?: unknown } | undefined)?.questions
  const questions = (Array.isArray(raw) ? raw : []).filter((entry): entry is { question: string; header?: string } => typeof entry?.question === 'string')
  const end = Math.max(...ANSWERS_END.map((tail) => result.lastIndexOf(tail)))
  const region = end >= 0 ? result.slice(0, end) : result
  let cursor = 0
  const found = questions.map((entry) => {
    const at = region.indexOf(`"${entry.question}"="`, cursor)
    if (at < 0) return undefined
    cursor = at + entry.question.length + 4
    return { at, start: cursor }
  })
  return questions.map((entry, index) => {
    const own = found[index]
    const next = found.slice(index + 1).find(Boolean)
    const segment = own ? region.slice(own.start, next ? next.at : region.length) : ''
    const close = segment.lastIndexOf('"')
    return { header: entry.header ?? '', question: entry.question, answer: own && close >= 0 ? segment.slice(0, close) : undefined }
  })
}

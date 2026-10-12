import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { CoreError } from './errors.ts'

// Where Claude Code keeps a folder's conversations: <claudeDir>/projects/<folder with every non-alphanumeric character
// turned into "-">. Longer names get a hash suffix the CLI computes (2.1.287), not reproduced here.
const MAX_PROJECT_DIR = 200

// The name of a folder's history directory under <claudeDir>/projects. path: an absolute folder. Throws invalid_args
// for a path too long to name it like the CLI does.
export function projectDirName(path: string): string {
  const name = path.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length > MAX_PROJECT_DIR) throw new CoreError('invalid_args', 'the folder path is too long to move a conversation into it')
  return name
}

// path with its `from` prefix replaced by `to` (path itself, or something inside it); other paths unchanged.
export function rebased(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(from + sep) ? join(to, relative(from, path)) : path
}

// A conversation file's lines with the `cwd` they record moved from `from` to `to` (lines that are not JSON, or have
// no cwd inside `from`, stay as they are).
function rewriteCwd(text: string, from: string, to: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.includes('"cwd"')) return line
      try {
        const entry = JSON.parse(line) as { cwd?: unknown }
        if (typeof entry.cwd !== 'string' || rebased(entry.cwd, from, to) === entry.cwd) return line
        return JSON.stringify({ ...entry, cwd: rebased(entry.cwd, from, to) })
      } catch {
        return line
      }
    })
    .join('\n')
}

// Moves a conversation file to `target` with its cwd rewritten (written beside it first, so a crash never leaves half
// a file), then removes the original.
async function moveFile(source: string, target: string, from: string, to: string): Promise<void> {
  const text = rewriteCwd(await readFile(source, 'utf8'), from, to)
  await writeFile(`${target}.moving`, text)
  await rename(`${target}.moving`, target)
  await rm(source)
}

// Moves a directory's tree (a session's subagents and tool results) to `target`, rewriting the cwd of its .jsonl files.
async function moveTree(source: string, target: string, from: string, to: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const [inside, outside] = [join(source, entry.name), join(target, entry.name)]
    if (entry.isDirectory()) await moveTree(inside, outside, from, to)
    else if (entry.name.endsWith('.jsonl')) await moveFile(inside, outside, from, to)
    else await rename(inside, outside)
  }
  await rm(source, { recursive: true, force: true })
}

// The history directory holding a stored conversation: the folder's own one, else any (a conversation the CLI stored
// under another name). undefined when it is stored nowhere (never sent).
async function findConversation(projects: string, sessionId: string, folder: string): Promise<string | undefined> {
  const own = join(projects, projectDirName(folder))
  if (existsSync(join(own, `${sessionId}.jsonl`))) return own
  const dirs = await readdir(projects, { withFileTypes: true }).catch(() => [])
  return dirs.map((dir) => join(projects, dir.name)).find((dir) => existsSync(join(dir, `${sessionId}.jsonl`)))
}

// Moves a stored conversation from folder `from` to folder `to`: its file and its directory (subagents, tool results)
// go to `to`'s history, every cwd they record inside `from` rewritten, so that the CLI resumes it from `to` and lists it
// there. Nothing happens for a conversation stored nowhere. claudeDir: Claude Code's config folder.
export async function moveConversation(claudeDir: string, sessionId: string, from: string, to: string): Promise<void> {
  const projects = join(claudeDir, 'projects')
  const source = await findConversation(projects, sessionId, from)
  if (!source) return
  const target = join(projects, projectDirName(to))
  if (source === target) return
  await mkdir(target, { recursive: true })
  await moveFile(join(source, `${sessionId}.jsonl`), join(target, `${sessionId}.jsonl`), from, to)
  if (existsSync(join(source, sessionId))) await moveTree(join(source, sessionId), join(target, sessionId), from, to)
}

// A folder's identity: device and inode, which a rename or a move on the same disk keeps. undefined when it is gone.
export async function folderId(path: string): Promise<string | undefined> {
  const info = await lstat(path).catch(() => undefined)
  return info?.isDirectory() ? `${info.dev}:${info.ino}` : undefined
}

// How deep under each starting folder, and how many folders at most, a lost folder is looked for.
const SEARCH_DEPTH = 5
const SEARCH_CAP = 20_000
// Never looked into: hidden folders and dependencies.
const skipped = (name: string) => name.startsWith('.') || name === 'node_modules'

// The folder with this identity under the starting folders (breadth first, the nearest first: a rename stays beside
// the old name), its real path; undefined if none. starts: where to look, in order (missing ones are skipped).
export async function findFolder(id: string, starts: string[]): Promise<string | undefined> {
  const seen = new Set<string>()
  for (const start of starts) {
    let level = [start]
    for (let depth = 0; depth <= SEARCH_DEPTH && level.length; depth++) {
      const next: string[] = []
      for (const folder of level) {
        if (seen.has(folder) || seen.size >= SEARCH_CAP) continue
        seen.add(folder)
        if (depth > 0 && (await folderId(folder)) === id) return realpath(folder)
        const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) if (entry.isDirectory() && !skipped(entry.name)) next.push(join(folder, entry.name))
      }
      level = next
    }
  }
  return undefined
}

// The folder a history directory belongs to: the cwd recorded in its first conversation that has one (the name alone
// is ambiguous: "a-b" may be a/b or a-b). undefined when none tells.
async function folderOfHistory(dir: string): Promise<string | undefined> {
  const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => '')
    const match = /"cwd":("(?:[^"\\]|\\.)*")/.exec(text)
    if (match) return JSON.parse(match[1]!) as string
  }
  return undefined
}

// Moves what a history directory holds into another one: conversations (cwd rewritten), their directories, Claude's
// memory and the rest; whatever the target already has stays where it was. keep: conversations left in place (their
// process still writes there). The source goes once empty.
async function mergeHistory(source: string, target: string, from: string, to: string, keep: Set<string>): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (keep.has(entry.name.replace(/\.jsonl$/, ''))) continue
    const [inside, outside] = [join(source, entry.name), join(target, entry.name)]
    if (entry.name.endsWith('.jsonl')) await moveFile(inside, outside, from, to)
    else if (!existsSync(outside)) await (entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name) ? moveTree(inside, outside, from, to) : rename(inside, outside))
  }
  await rmdir(source).catch(() => undefined)
}

// A folder moved from `from` to `to`: the history of it and of every folder inside it follows (its past sessions,
// Claude's memory of it), cwd rewritten. keep: sessions whose process is still running (they move at the end of their
// turn). claudeDir: Claude Code's config folder.
export async function moveFolderHistory(claudeDir: string, from: string, to: string, keep: Set<string>): Promise<void> {
  const projects = join(claudeDir, 'projects')
  const own = projectDirName(from)
  for (const name of await readdir(projects).catch(() => [])) {
    if (name !== own && !name.startsWith(`${own}-`)) continue
    const dir = join(projects, name)
    const folder = name === own ? from : await folderOfHistory(dir)
    if (!folder || rebased(folder, from, to) === folder) continue
    await mergeHistory(dir, join(projects, projectDirName(rebased(folder, from, to))), from, to, keep)
  }
}

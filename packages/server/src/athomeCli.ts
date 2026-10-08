import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, WORKSPACE_STREAM, coreFrameSchema, type CoreActionName, type CoreFrame, type WorkspaceSnapshot } from '@athome/protocol'

// The athome command: uses the AtHome server from a terminal (a person, a script, Claude through its Bash tool) over
// the terminal socket. What it may do is decided by core's terminal policy, not here: run by a person in a terminal it
// acts at once; run by Claude in an AtHome session it waits for the confirmation in that chat; anything else is refused.

export const USAGE = `usage:
  athome projects [--json]                                   the projects of the Home
  athome sessions [--json]                                   the open sessions (chats)
  athome project create <name> [--in <folder>] [--json]      a new project folder (default: in the Home)
  athome session start <folder> [--prompt <text>] [--json]   a new session in a folder, with an optional first prompt

Run by you in a terminal, it acts at once. Run by Claude in an AtHome session, AtHome asks you to confirm in that
chat and the command waits for your answer (give it a timeout of a few minutes). Any other program may only list.
It never writes to sessions already open. Exit codes: 0 done, 1 error, 2 wrong command line, 3 not allowed.`

// Where the command runs: the socket, the folder relative paths start from, whether a person types in this terminal,
// the AtHome chat it runs in (CLAUDE_WRAP_TAB_ID), and where its output goes.
export type CliIo = { socket: string; cwd: string; interactive: boolean; tabId?: string; out(line: string): void; err(line: string): void }

// A command line, read: what to do and how to print it.
type Parsed = { kind: 'help' } | { kind: 'list'; what: 'projects' | 'sessions' } | { kind: 'action'; action: CoreActionName; args: Record<string, unknown> }

class UsageError extends Error {}
class Refused extends Error {}

// The terminal socket, connected and greeted: the workspace snapshot and a request function.
type Terminal = { snapshot: WorkspaceSnapshot; request(name: string, args: object): Promise<unknown>; close(): void }

// Takes `--flag value` options out of a command line. Returns the other words and the options' values.
function options(words: string[], names: string[]): { rest: string[]; values: Record<string, string>; json: boolean } {
  const rest: string[] = []
  const values: Record<string, string> = {}
  let json = false
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    if (word === '--json') json = true
    else if (names.includes(word) && words[index + 1] !== undefined) values[word.slice(2)] = words[++index]!
    else if (word.startsWith('--')) throw new UsageError(`unknown option ${word}`)
    else rest.push(word)
  }
  return { rest, values, json }
}

// Reads a command line. cwd: where relative folders start. Throws UsageError.
function parse(argv: string[], cwd: string): Parsed & { json: boolean } {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help' || argv[0] === '-h') return { kind: 'help', json: false }
  const { rest, values, json } = options(argv, ['--in', '--prompt'])
  const [first, second, third, ...extra] = rest
  if (extra.length) throw new UsageError('too many words')
  if ((first === 'projects' || first === 'sessions') && second === undefined) return { kind: 'list', what: first, json }
  if (first === 'project' && second === 'create' && third) return { kind: 'action', action: 'project.create', args: { name: third, ...(values.in ? { parent: resolve(cwd, values.in) } : {}) }, json }
  if (first === 'session' && second === 'start' && third) return { kind: 'action', action: 'session.start', args: { folder: resolve(cwd, third), ...(values.prompt ? { prompt: values.prompt } : {}) }, json }
  throw new UsageError('unknown command')
}

// Connects to the terminal socket and says hello; resolves once the workspace snapshot arrived.
function connect(socket: string): Promise<Terminal> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws+unix://${socket}:/ws`)
    const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    ws.once('error', () => fail(new Error(`AtHome is not running (no terminal socket at ${socket})`)))
    ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: `athome-${randomUUID()}`, visible: false, resume: {} })))
    ws.on('message', (data) => {
      const parsed = coreFrameSchema.safeParse(JSON.parse(data.toString()))
      if (parsed.success) onFrame(parsed.data)
    })
    // One frame of core: the snapshot (connected), a reply, or a fatal error.
    function onFrame(frame: CoreFrame): void {
      if (frame.t === 'reset' && frame.stream === WORKSPACE_STREAM && frame.snapshot.kind === 'workspace') done({ snapshot: frame.snapshot, request, close: () => ws.close() })
      else if (frame.t === 'fatal') fail(new Error(frame.error.message))
      else if (frame.t === 'reply') {
        const pending = waiting.get(frame.id)
        waiting.delete(frame.id)
        if (frame.ok) pending?.resolve(frame.result)
        else pending?.reject(frame.error.code === 'action_denied' ? new Refused(frame.error.message) : new Error(frame.error.message))
      }
    }
    // Sends a command; resolves with its result.
    function request(name: string, args: object): Promise<unknown> {
      const id = randomUUID()
      ws.send(JSON.stringify({ t: 'cmd', id, name, args }))
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
    }
  })
}

// Prints the projects or the open sessions.
function list(terminal: Terminal, what: 'projects' | 'sessions', json: boolean, io: CliIo): void {
  const { projects, tabs } = terminal.snapshot
  if (what === 'projects') {
    if (json) return io.out(JSON.stringify(projects.map((path) => ({ name: basename(path), path }))))
    return projects.forEach((path) => io.out(`${basename(path)}\t${path}`))
  }
  const sessions = tabs.map(({ tabId, title, cwd, status }) => ({ tabId, title, cwd, status }))
  if (json) return io.out(JSON.stringify(sessions))
  sessions.forEach((session) => io.out(`${session.tabId}\t${session.status}\t${session.title}\t${session.cwd}`))
}

// Runs an action and prints what it did.
async function act(terminal: Terminal, parsed: Extract<Parsed, { kind: 'action' }>, json: boolean, io: CliIo): Promise<void> {
  if (!io.interactive && io.tabId) io.err('Waiting for the confirmation in the AtHome chat…')
  const run = { action: parsed.action, args: parsed.args, source: 'terminal', interactive: io.interactive, ...(io.tabId ? { tabId: io.tabId } : {}) }
  const { value } = (await terminal.request('actions.run', run)) as { value?: { path?: string; tabId?: string; needsTrust?: boolean } }
  if (json) return io.out(JSON.stringify(value ?? {}))
  if (value?.path) io.out(`Project created: ${value.path}`)
  if (value?.tabId) io.out(`Session started: ${value.tabId}${value.needsTrust ? ' (trust the folder in AtHome, then send the prompt from there)' : ''}`)
}

// Runs the command. argv: its words; io: where it runs. Returns the exit code.
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed: Parsed & { json: boolean }
  try {
    parsed = parse(argv, io.cwd)
  } catch (error) {
    io.err(`${(error as Error).message}\n${USAGE}`)
    return 2
  }
  if (parsed.kind === 'help') return (io.out(USAGE), 0)
  let terminal: Terminal | undefined
  try {
    terminal = await connect(io.socket)
    if (parsed.kind === 'list') list(terminal, parsed.what, parsed.json, io)
    else await act(terminal, parsed, parsed.json, io)
    return 0
  } catch (error) {
    io.err(error instanceof Refused ? `Not allowed: ${error.message}` : (error as Error).message)
    return error instanceof Refused ? 3 : 1
  } finally {
    terminal?.close()
  }
}

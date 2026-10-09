import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  WORKSPACE_STREAM,
  coreFrameSchema,
  planNext,
  planProposalSchema,
  tabStream,
  type CoreActionName,
  type CoreFrame,
  type Item,
  type Plan,
  type TabMeta,
  type TabSnapshot,
  type WorkspaceSnapshot
} from '@athome/protocol'

// The athome command: uses the AtHome server from a terminal (a person, a script, Claude through its Bash tool, a
// caller with a key such as Petra) over the terminal socket. What it may do is decided by core, not here: a person in
// a terminal acts at once; Claude in an AtHome session waits for the confirmation in that chat; a caller with a key
// (ATHOME_KEY) acts only inside a plan the user approved (--plan / ATHOME_PLAN), naming the step (--step /
// ATHOME_STEP) when an action fits more than one the plan allows now; anything else may only read.

export const USAGE = `usage:
  athome projects [--json]                                 the projects of the Home
  athome sessions [--json]                                 the open sessions (chats)
  athome session read <id> [--last <n>] [--json]           the last messages of a chat
  athome session wait <id> [--timeout <s>] [--json]        waits for Claude to finish (or to ask), prints its last reply
  athome project create <name> [--in <folder>] [--json]    a new project folder (default: in the Home)
  athome session start <folder> [--prompt <text>] [--json] a new session in a folder, with an optional first prompt

With a key (ATHOME_KEY), inside an approved plan (--plan <id> or ATHOME_PLAN), also:
  athome plan propose <file.json | -> [--wait]             proposes a plan ({summary, steps}); --wait: until answered
  athome plan status <id> [--json]                         the steps the plan allows now, or closed
  athome plan finish <id>                                  ends the plan once only skippable steps are left
  athome plan cancel <id>
  athome folder create <name> --in <folder>                a plain folder
  athome project mark <path> [--off]                       the project mark of a folder
  athome session send <id> <text>                          a message in a chat already open
  athome session follow <id>                               follows a chat's turn, answering its requests meanwhile
  athome session stop <id> | session close <id>
  athome queue add <id> <text> | queue remove <id> <queueId>
  athome request answer <id> allow|deny [--answers <json>]

When an action fits two steps the plan allows now, add --step <n> (or ATHOME_STEP=<n>): the step's number.
By hand, in a terminal: athome key create <name> | key list | key revoke <name>
Run by you in a terminal, it acts at once. Run by Claude in an AtHome session, AtHome asks you to confirm in that
chat and the command waits (give it a timeout of a few minutes). It never writes to sessions already open without a
plan. Exit codes: 0 done, 1 error, 2 wrong command line, 3 not allowed.`

// Where the command runs: the socket, the folder relative paths start from, whether a person types in this terminal,
// the AtHome chat it runs in (CLAUDE_WRAP_TAB_ID), a caller's key, plan and step (ATHOME_STEP), standard input, and
// where its output goes.
export type CliIo = { socket: string; cwd: string; interactive: boolean; tabId?: string; key?: string; plan?: string; step?: number; stdin?: () => Promise<string>; out(line: string): void; err(line: string): void }

// A command line, read.
type Parsed =
  | { kind: 'help' }
  | { kind: 'list'; what: 'projects' | 'sessions' }
  | { kind: 'read'; tabId: string; last: number }
  | { kind: 'wait'; tabId: string; timeoutMs: number }
  | { kind: 'action'; action: CoreActionName; args: Record<string, unknown>; tabId?: string; step?: number }
  | { kind: 'plan'; op: 'propose'; source: string; wait: boolean }
  | { kind: 'plan'; op: 'status' | 'cancel' | 'finish'; planId: string }
  | { kind: 'key'; op: 'create' | 'list' | 'revoke'; name?: string }

class UsageError extends Error {}
class Refused extends Error {}

// The terminal socket, connected and greeted: the workspace as it now is (kept up to date), requests, waiting.
type Terminal = {
  snapshot: WorkspaceSnapshot
  request(name: string, args: object): Promise<unknown>
  // Resolves when the predicate holds (checked after every frame), or rejects after timeoutMs.
  waitFor(predicate: () => boolean, timeoutMs: number): Promise<void>
  // Subscribes to a chat and resolves with its snapshot.
  chat(tabId: string): Promise<TabSnapshot>
  close(): void
}

const BUSY: TabMeta['status'][] = ['running', 'starting', 'closing']
const DEFAULT_LAST = 5
const DEFAULT_WAIT_S = 600

// Takes `--flag value` options and flags out of a command line. Returns the other words, the values and the flags.
function options(words: string[], valued: string[], flags: string[]): { rest: string[]; values: Record<string, string>; flags: Set<string> } {
  const rest: string[] = []
  const values: Record<string, string> = {}
  const seen = new Set<string>()
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    if (flags.includes(word)) seen.add(word.slice(2))
    else if (valued.includes(word) && words[index + 1] !== undefined) values[word.slice(2)] = words[++index]!
    else if (word.startsWith('--')) throw new UsageError(`unknown option ${word}`)
    else rest.push(word)
  }
  return { rest, values, flags: seen }
}

// Reads a command line. cwd: where relative folders start. Throws UsageError.
function parse(argv: string[], cwd: string): { parsed: Parsed; json: boolean } {
  if (argv.length === 0 || ['--help', 'help', '-h'].includes(argv[0]!)) return { parsed: { kind: 'help' }, json: false }
  const { rest, values, flags } = options(argv, ['--in', '--prompt', '--last', '--timeout', '--answers', '--step'], ['--json', '--wait', '--off'])
  const step = values.step === undefined ? undefined : Number(values.step)
  if (step !== undefined && !(Number.isInteger(step) && step >= 1)) throw new UsageError('--step needs a step number')
  const json = flags.has('json')
  const [a, b, c, d, ...extra] = rest
  const folder = (path: string) => resolve(cwd, path)
  const parsed = ((): Parsed => {
    if (extra.length) throw new UsageError('too many words')
    if ((a === 'projects' || a === 'sessions') && b === undefined) return { kind: 'list', what: a }
    if (a === 'session' && b === 'read' && c && d === undefined) return { kind: 'read', tabId: c, last: Number(values.last ?? DEFAULT_LAST) || DEFAULT_LAST }
    if (a === 'session' && b === 'wait' && c && d === undefined) return { kind: 'wait', tabId: c, timeoutMs: (Number(values.timeout ?? DEFAULT_WAIT_S) || DEFAULT_WAIT_S) * 1000 }
    if (a === 'project' && b === 'create' && c && d === undefined) return { kind: 'action', action: 'project.create', args: { name: c, ...(values.in ? { parent: folder(values.in) } : {}) } }
    if (a === 'session' && b === 'start' && c && d === undefined) return { kind: 'action', action: 'session.start', args: { folder: folder(c), ...(values.prompt ? { prompt: values.prompt } : {}) } }
    if (a === 'plan' && b === 'propose' && c && d === undefined) return { kind: 'plan', op: 'propose', source: c, wait: flags.has('wait') }
    if (a === 'plan' && (b === 'status' || b === 'cancel' || b === 'finish') && c && d === undefined) return { kind: 'plan', op: b, planId: c }
    if (a === 'folder' && b === 'create' && c && d === undefined) {
      if (!values.in) throw new UsageError('folder create needs --in <folder>')
      return { kind: 'action', action: 'folder.create', args: { parent: folder(values.in), name: c } }
    }
    if (a === 'project' && b === 'mark' && c && d === undefined) return { kind: 'action', action: 'project.mark', args: { path: folder(c), project: !flags.has('off') } }
    if (a === 'session' && b === 'send' && c && d !== undefined) return { kind: 'action', action: 'prompt.send', args: { text: d }, tabId: c }
    if (a === 'session' && (b === 'follow' || b === 'stop' || b === 'close') && c && d === undefined) return { kind: 'action', action: `session.${b}`, args: {}, tabId: c }
    if (a === 'queue' && b === 'add' && c && d !== undefined) return { kind: 'action', action: 'queue.add', args: { text: d }, tabId: c }
    if (a === 'queue' && b === 'remove' && c && d !== undefined) return { kind: 'action', action: 'queue.remove', args: { queueId: d }, tabId: c }
    if (a === 'request' && b === 'answer' && c && (d === 'allow' || d === 'deny')) return { kind: 'action', action: 'request.answer', args: { decision: d, ...(values.answers ? { answers: JSON.parse(values.answers) as unknown } : {}) }, tabId: c }
    if (a === 'key' && (b === 'create' || b === 'revoke') && c && d === undefined) return { kind: 'key', op: b, name: c }
    if (a === 'key' && b === 'list' && c === undefined) return { kind: 'key', op: 'list' }
    throw new UsageError('unknown command')
  })()
  return { parsed: parsed.kind === 'action' && step !== undefined ? { ...parsed, step } : parsed, json }
}

// Connects to the terminal socket and says hello (with the caller's key, if any); resolves once the workspace
// snapshot arrived, and keeps it up to date from then on.
function connect(socket: string, key?: string): Promise<Terminal> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws+unix://${socket}:/ws`)
    const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    const chats = new Map<string, (snapshot: TabSnapshot) => void>()
    const listeners: (() => void)[] = []
    let terminal: Terminal | undefined
    ws.once('error', () => fail(new Error(`AtHome is not running (no terminal socket at ${socket})`)))
    ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: `athome-${randomUUID()}`, visible: false, resume: {}, ...(key ? { token: key } : {}) })))
    ws.on('message', (data) => {
      const parsed = coreFrameSchema.safeParse(JSON.parse(data.toString()))
      if (parsed.success) onFrame(parsed.data)
      listeners.splice(0).forEach((wake) => wake())
    })
    ws.on('close', () => listeners.splice(0).forEach((wake) => wake()))
    // One frame of core: the workspace (connected) or a chat's snapshot, a workspace event, a reply, a fatal error.
    function onFrame(frame: CoreFrame): void {
      if (frame.t === 'reset' && frame.snapshot.kind === 'workspace') {
        if (terminal) terminal.snapshot = frame.snapshot
        else done((terminal = make(frame.snapshot)))
      } else if (frame.t === 'reset' && frame.snapshot.kind === 'tab') chats.get(frame.stream)?.(frame.snapshot)
      else if (frame.t === 'ev' && frame.stream === WORKSPACE_STREAM && terminal) apply(terminal.snapshot, frame.ev)
      else if (frame.t === 'fatal') fail(new Refused(frame.error.message))
      else if (frame.t === 'reply') {
        const pending = waiting.get(frame.id)
        waiting.delete(frame.id)
        if (frame.ok) pending?.resolve(frame.result)
        else pending?.reject(frame.error.code === 'action_denied' || frame.error.code === 'unauthorized' ? new Refused(frame.error.message) : new Error(frame.error.message))
      }
    }
    function make(snapshot: WorkspaceSnapshot): Terminal {
      const request = (name: string, args: object): Promise<unknown> => {
        const id = randomUUID()
        ws.send(JSON.stringify({ t: 'cmd', id, name, args }))
        return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
      }
      const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
        const deadline = Date.now() + timeoutMs
        while (!predicate()) {
          if (ws.readyState !== ws.OPEN) throw new Error('AtHome went away')
          if (Date.now() >= deadline) throw new Error('timed out')
          await new Promise<void>((wake) => {
            const timer = setTimeout(wake, Math.min(1000, deadline - Date.now()))
            listeners.push(() => (clearTimeout(timer), wake()))
          })
        }
      }
      const chat = (tabId: string): Promise<TabSnapshot> =>
        new Promise((resolve, reject) => {
          chats.set(tabStream(tabId), resolve)
          request('tab.subscribe', { tabId }).catch(reject)
        })
      return { snapshot, request, waitFor, chat, close: () => ws.close() }
    }
  })
}

// Keeps the workspace snapshot up to date from an event (the tabs and the plans are what the command reads).
function apply(snapshot: WorkspaceSnapshot, ev: { type: string } & Record<string, unknown>): void {
  if (ev.type === 'tab.added' || ev.type === 'tab.updated') {
    const tab = ev.tab as TabMeta
    snapshot.tabs = [...snapshot.tabs.filter((one) => one.tabId !== tab.tabId), tab]
  } else if (ev.type === 'tab.removed') snapshot.tabs = snapshot.tabs.filter((one) => one.tabId !== ev.tabId)
  else if (ev.type === 'plans.updated') snapshot.plans = ev.plans as Plan[]
  else if (ev.type === 'folders.updated') snapshot.projects = ev.projects as string[]
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

// The messages of a chat worth reading from a terminal: the user's prompts and Claude's replies.
type Line = { who: 'user' | 'claude'; text: string }
function lines(items: Item[]): Line[] {
  return items.flatMap((item): Line[] => (item.kind === 'user' ? [{ who: 'user', text: item.text }] : item.kind === 'assistantText' ? [{ who: 'claude', text: item.text }] : []))
}

// Prints the last messages of a chat.
async function read(terminal: Terminal, tabId: string, last: number, json: boolean, io: CliIo): Promise<void> {
  const snapshot = await terminal.chat(tabId)
  const shown = lines(snapshot.items).slice(-last)
  if (json) return io.out(JSON.stringify(shown))
  shown.forEach((line) => io.out(`${line.who}: ${line.text}`))
}

// Waits until the chat's turn is over (Claude finished, or asks something), then prints its last reply.
async function wait(terminal: Terminal, tabId: string, timeoutMs: number, json: boolean, io: CliIo): Promise<void> {
  const tab = () => terminal.snapshot.tabs.find((one) => one.tabId === tabId)
  if (!tab()) throw new Error(`no open session ${tabId}`)
  await terminal.waitFor(() => !BUSY.includes(tab()?.status ?? 'idle'), timeoutMs)
  const status = tab()?.status ?? 'closed'
  const snapshot = status === 'closed' ? undefined : await terminal.chat(tabId)
  const reply = snapshot ? lines(snapshot.items).filter((line) => line.who === 'claude').at(-1)?.text : undefined
  const request = snapshot?.requests[0]
  if (json) return io.out(JSON.stringify({ status, reply, ...(request ? { request: { kind: request.kind, title: request.title ?? request.toolName } } : {}) }))
  if (request) io.out(`waiting for you: ${request.title ?? request.toolName}`)
  if (reply !== undefined) io.out(`claude: ${reply}`)
  else io.out(status)
}

// Runs an action and prints what it did.
async function act(terminal: Terminal, parsed: Extract<Parsed, { kind: 'action' }>, json: boolean, io: CliIo): Promise<void> {
  if (!io.interactive && io.tabId && !io.key) io.err('Waiting for the confirmation in the AtHome chat…')
  const step = parsed.step ?? io.step
  const run = { action: parsed.action, args: parsed.args, source: 'terminal', interactive: io.interactive, ...(parsed.tabId ?? io.tabId ? { tabId: parsed.tabId ?? io.tabId } : {}), ...(io.plan ? { plan: io.plan } : {}), ...(step ? { step } : {}) }
  const { value } = (await terminal.request('actions.run', run)) as { value?: { path?: string; tabId?: string; needsTrust?: boolean; queueId?: string; following?: boolean } }
  if (json) return io.out(JSON.stringify(value ?? {}))
  if (value?.path) io.out(`Created: ${value.path}`)
  else if (value?.tabId) io.out(`Session started: ${value.tabId}${value.needsTrust ? ' (trust the folder in AtHome, then send the prompt from there)' : ''}`)
  else if (value?.queueId) io.out(`Queued: ${value.queueId}`)
  else if (value?.following !== undefined) io.out(value.following ? 'Following: Claude is at work, answer its requests until it finishes' : 'Claude was idle: nothing to follow')
  else io.out('Done')
}

// Proposes a plan (from a file or standard input), prints its id; --wait: waits for the user's answer.
async function propose(terminal: Terminal, source: string, waitForAnswer: boolean, json: boolean, io: CliIo): Promise<number> {
  const text = source === '-' ? await (io.stdin ?? (() => Promise.resolve('')))() : await readFile(resolve(io.cwd, source), 'utf8')
  const proposal = planProposalSchema.safeParse(JSON.parse(text))
  if (!proposal.success) throw new UsageError(`not a plan: ${proposal.error.issues.map((issue) => `${issue.path.join('.') || 'plan'} ${issue.message}`).join('; ')}`)
  const { planId } = (await terminal.request('plans.propose', proposal.data)) as { planId: string }
  if (!waitForAnswer) return (io.out(json ? JSON.stringify({ planId }) : planId), 0)
  io.err('Waiting for the answer in AtHome…')
  const plan = () => terminal.snapshot.plans?.find((one) => one.planId === planId)
  await terminal.waitFor(() => plan()?.status !== 'proposed', DEFAULT_WAIT_S * 1000 * 144)
  const approved = plan()?.status === 'running'
  io.out(json ? JSON.stringify({ planId, approved }) : `${planId}\t${approved ? 'approved' : 'rejected'}`)
  return approved ? 0 : 3
}

// A plan's state: the step numbers it allows now and whether it may be finished, or that it follows a chat (open
// plans only: a closed one is done, rejected, cancelled or expired).
function status(terminal: Terminal, planId: string, json: boolean, io: CliIo): void {
  const plan = terminal.snapshot.plans?.find((one) => one.planId === planId)
  if (!plan) return io.out(json ? JSON.stringify({ status: 'closed' }) : 'closed')
  const { next, finishable } = planNext(plan.steps, plan.at)
  const numbers = plan.following ? [] : next.map((move) => move.number)
  if (json) return io.out(JSON.stringify({ status: plan.status, next: numbers, finishable, following: Boolean(plan.following) }))
  if (plan.following) return io.out(`${plan.status}\tfollowing a chat (${plan.following}): answer its requests until Claude finishes`)
  io.out(`${plan.status}\tnext: step ${numbers.join(' or ')}${finishable ? ', or finish' : ''}`)
}

// Keys of the callers: by a person at a terminal only.
async function keys(terminal: Terminal, parsed: Extract<Parsed, { kind: 'key' }>, json: boolean, io: CliIo): Promise<void> {
  if (!io.interactive) throw new Refused('keys are made and revoked by hand, in a terminal')
  if (parsed.op === 'create') {
    const { key } = (await terminal.request('callers.create', { name: parsed.name, interactive: true })) as { key: string }
    if (json) return io.out(JSON.stringify({ name: parsed.name, key }))
    io.out(`Key of ${parsed.name} (shown once; give it as ATHOME_KEY):`)
    return io.out(`  ${key}`)
  }
  if (parsed.op === 'revoke') return (await terminal.request('callers.revoke', { name: parsed.name, interactive: true }), io.out(`Revoked: ${parsed.name}`))
  const { callers } = (await terminal.request('callers.list', { interactive: true })) as { callers: { name: string; createdAt: number }[] }
  if (json) return io.out(JSON.stringify(callers))
  callers.forEach((caller) => io.out(`${caller.name}\t${new Date(caller.createdAt).toISOString()}`))
}

// Runs the command. argv: its words; io: where it runs. Returns the exit code.
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let read0: { parsed: Parsed; json: boolean }
  try {
    read0 = parse(argv, io.cwd)
  } catch (error) {
    io.err(`${(error as Error).message}\n${USAGE}`)
    return 2
  }
  const { parsed, json } = read0
  if (parsed.kind === 'help') return (io.out(USAGE), 0)
  let terminal: Terminal | undefined
  try {
    terminal = await connect(io.socket, io.key)
    if (parsed.kind === 'list') list(terminal, parsed.what, json, io)
    else if (parsed.kind === 'read') await read(terminal, parsed.tabId, parsed.last, json, io)
    else if (parsed.kind === 'wait') await wait(terminal, parsed.tabId, parsed.timeoutMs, json, io)
    else if (parsed.kind === 'action') await act(terminal, parsed, json, io)
    else if (parsed.kind === 'key') await keys(terminal, parsed, json, io)
    else if (parsed.op === 'propose') return await propose(terminal, parsed.source, parsed.wait, json, io)
    else if (parsed.op === 'status') status(terminal, parsed.planId, json, io)
    else if (parsed.op === 'finish') await terminal.request('plans.finish', { planId: parsed.planId }).then(() => io.out(`Finished: ${parsed.planId}`))
    else await terminal.request('plans.cancel', { planId: parsed.planId }).then(() => io.out(`Cancelled: ${parsed.planId}`))
    return 0
  } catch (error) {
    if (error instanceof UsageError) return (io.err(`${error.message}\n${USAGE}`), 2)
    io.err(error instanceof Refused ? `Not allowed: ${error.message}` : (error as Error).message)
    return error instanceof Refused ? 3 : 1
  } finally {
    terminal?.close()
  }
}

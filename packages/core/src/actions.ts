import { randomUUID } from 'node:crypto'
import { CORE_ACTIONS, type ActionConfirmation, type CommandArgs, type CommandName, type CoreActionArgs, type CoreActionName, type PermissionMode } from '@athome/protocol'
import type { ActionOutcome } from './actionLog.ts'
import type { Connection } from './commands.ts'
import { CoreError } from './errors.ts'
import { createFolder } from './folders.ts'
import type { Tab } from './tab.ts'
import { checkRoots } from './trustGate.ts'
import type { Workspace } from './workspace.ts'

// The action API's core side (actions.run): checks who asks and an action's arguments, asks the user before the heavy
// ones (creating a project, starting a session, allowing what Claude asked), then runs it with the commands the app
// already has, and logs it. The actions of the client's own screen (composer, open a file or a screen) are not here.
// Two sources: a chat widget (an app client, for its chat) and the athome command (the server's terminal socket).

// What the athome command may do (Sasha, 2026-10-08: every limit on for now, each one can be lifted later).
// actions: the actions it may run (not prompt.send or request.answer: nothing reaches a session already open).
// interactiveActsDirectly: run at once when a person types the command in a terminal (best effort: a program of the
// same user could claim to be one). othersMayAct: programs that are neither (no terminal, not in an AtHome chat) may
// act too. sessionsPerHour: new sessions it may start in an hour. newSessionMode: the permission mode of a session
// started by a program (undefined: the usual default).
export type TerminalPolicy = { actions: CoreActionName[]; interactiveActsDirectly: boolean; othersMayAct: boolean; sessionsPerHour: number; newSessionMode?: PermissionMode }
export const DEFAULT_TERMINAL_POLICY: TerminalPolicy = { actions: ['project.create', 'session.start'], interactiveActsDirectly: true, othersMayAct: false, sessionsPerHour: 10, newSessionMode: 'default' }
// The only commands a terminal connection may send (it also gets the workspace snapshot, read only).
export const TERMINAL_COMMANDS: ReadonlySet<CommandName> = new Set<CommandName>(['actions.run', 'folders.list'])

const HOUR_MS = 60 * 60 * 1000

// Who runs an action: the workspace, the chat it comes from (if any), who asked and the client's name; direct: no
// confirmation (a person at a terminal); mode: the permission mode of a session it starts.
type Context = { workspace: Workspace; tab?: Tab; source: ActionConfirmation['source']; by: string; direct: boolean; mode?: PermissionMode }
type Runner<Name extends CoreActionName> = (context: Context, args: CoreActionArgs<Name>) => Promise<unknown>

// Thrown when the user denies a confirmation (logged as denied; a refusal of the policy is logged as refused).
class Denied extends CoreError {
  constructor() {
    super('action_denied', 'the user did not allow it')
  }
}

// Asks the user before a heavy action, in the chat it comes from; nothing to ask when direct. Throws action_denied
// unless they allow it (or when there is no chat to ask in).
async function confirmed(context: Context, action: CoreActionName, args: object, about?: ActionConfirmation['about']): Promise<void> {
  if (context.direct) return
  if (!context.tab) throw new CoreError('action_denied', 'no chat to ask the user in')
  const allowed = await context.tab.confirmAction({ action, args: { ...args }, source: context.source, ...(about ? { about } : {}) })
  if (!allowed) throw new Denied()
}

// The chat an action acts on; invalid_args when it came without one.
function chatOf(context: Context): Tab {
  if (!context.tab) throw new CoreError('invalid_args', 'this action needs a chat (tabId)')
  return context.tab
}

// prompt.send: a message in the chat, as if typed.
const sendPrompt: Runner<'prompt.send'> = async (context, { text }) => {
  await chatOf(context).send({ queueId: randomUUID(), text, from: context.by })
  return {}
}

// request.answer: answers the chat's first request from Claude. Allowing a permission or a plan asks first; answering a
// question or denying does not. not_found when nothing waits for an answer.
const answerRequest: Runner<'request.answer'> = async (context, { decision, answers }) => {
  const tab = chatOf(context)
  const request = tab.openRequests().find((open) => open.kind !== 'action')
  if (!request) throw new CoreError('not_found', 'no request waits for an answer in this chat')
  if (decision === 'allow' && request.kind !== 'question') await confirmed(context, 'request.answer', { decision }, { toolName: request.toolName, ...(request.title ? { title: request.title } : {}) })
  tab.answer(request.requestId, { decision, ...(answers ? { answers } : {}) }, context.by)
  return {}
}

// project.create: a folder marked as a project, in parent (default: the Home's first folder). Returns {path}.
const createProject: Runner<'project.create'> = async (context, { name, parent }) => {
  const { workspace } = context
  const home = workspace.home()
  const base = parent ?? (home.kind === 'root' ? home.path : home.folders[0])
  if (!base) throw new CoreError('invalid_args', 'say in which folder to create the project')
  checkRoots(base, workspace.allowedRoots)
  await confirmed(context, 'project.create', parent ? { name, parent } : { name, parent: base })
  const created = await createFolder(base, name, workspace.allowedRoots)
  await workspace.setProject(created.path, true)
  return { path: created.path }
}

// session.start: a new chat in a folder of the Home, with an optional first prompt. Returns {tabId}, and needsTrust
// when the folder must be trusted first (the prompt is then not sent: the chat asks for trust).
const startSession: Runner<'session.start'> = async (context, { folder, prompt }) => {
  const { workspace, by } = context
  checkRoots(folder, workspace.allowedRoots)
  await confirmed(context, 'session.start', prompt ? { folder, prompt } : { folder })
  const tabId = workspace.create(workspace.withDefaults({ tabId: randomUUID(), cwd: folder, ...(context.mode ? { mode: context.mode } : {}) }))
  if (!prompt) return { tabId }
  try {
    await workspace.tabOf(tabId).send({ queueId: randomUUID(), text: prompt, from: by })
    return { tabId }
  } catch (error) {
    if (error instanceof CoreError && error.code === 'needs_trust') return { tabId, needsTrust: true }
    throw error
  }
}

const RUNNERS: { [Name in CoreActionName]: Runner<Name> } = {
  'prompt.send': sendPrompt,
  'request.answer': answerRequest,
  'project.create': createProject,
  'session.start': startSession
}

// The context of an action from the terminal, by the policy: direct for a person at a terminal, otherwise confirmed in
// the AtHome chat that ran the command. Throws action_denied (not allowed) or limit_reached (too many sessions).
function terminalContext(workspace: Workspace, run: CommandArgs<'actions.run'>, base: Omit<Context, 'direct'>): Context {
  const policy = workspace.terminalPolicy
  if (!policy.actions.includes(run.action)) throw new CoreError('action_denied', `${run.action} is not available from the terminal`)
  const direct = Boolean(run.interactive) && policy.interactiveActsDirectly
  if (!direct && !base.tab && !policy.othersMayAct) throw new CoreError('action_denied', 'only a person at a terminal, or a Claude session of AtHome, can do this')
  const started = workspace.actionLog.countDone(Date.now() - HOUR_MS, (entry) => entry.source === 'terminal' && entry.action === 'session.start')
  if (run.action === 'session.start' && started >= policy.sessionsPerHour) throw new CoreError('limit_reached', `at most ${policy.sessionsPerHour} new sessions an hour from the terminal`)
  return { ...base, direct, ...(direct ? {} : { mode: policy.newSessionMode }) }
}

// Who may say they are which source: the terminal socket only the terminal, an app client only a widget (with its chat).
function checkCaller(run: CommandArgs<'actions.run'>, connection: Connection): void {
  const terminal = Boolean(connection.terminal)
  if ((run.source === 'terminal') !== terminal) throw new CoreError('unauthorized', `a ${terminal ? 'terminal' : 'client'} connection cannot run ${run.source} actions`)
  if (run.source === 'widget' && !run.tabId) throw new CoreError('invalid_args', 'a widget action needs its chat (tabId)')
}

// The outcome a failed action is logged with.
function outcomeOf(error: unknown): ActionOutcome {
  if (error instanceof Denied) return 'denied'
  return error instanceof CoreError && (error.code === 'action_denied' || error.code === 'limit_reached' || error.code === 'unauthorized') ? 'refused' : 'failed'
}

// Runs one action. run: the actions.run arguments; connection: who sent it. Returns the action's value; throws
// invalid_args (bad arguments), unauthorized (wrong source), action_denied, limit_reached, or the errors of the
// command it uses. Every action that names a known action is logged with how it ended.
export async function runAction(workspace: Workspace, run: CommandArgs<'actions.run'>, connection: Connection): Promise<unknown> {
  const { tabId, action, args, source } = run
  const log = (outcome: ActionOutcome) => workspace.actionLog.add({ at: Date.now(), action, args, source, by: connection.label, ...(tabId ? { tabId } : {}), outcome })
  try {
    checkCaller(run, connection)
    const parsed = CORE_ACTIONS[action].safeParse(args)
    if (!parsed.success) throw new CoreError('invalid_args', `${action}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'} ${issue.message}`).join('; ')}`)
    const base = { workspace, tab: tabId ? workspace.tabOf(tabId) : undefined, source, by: connection.label }
    const context = source === 'terminal' ? terminalContext(workspace, run, base) : { ...base, direct: false }
    const value = await (RUNNERS[action] as Runner<CoreActionName>)(context, parsed.data as never)
    log('done')
    return value
  } catch (error) {
    log(outcomeOf(error))
    throw error
  }
}

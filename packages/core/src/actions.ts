import { randomUUID } from 'node:crypto'
import { CORE_ACTIONS, type ActionConfirmation, type CommandArgs, type CoreActionArgs, type CoreActionName } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { createFolder } from './folders.ts'
import type { Tab } from './tab.ts'
import { checkRoots } from './trustGate.ts'
import type { Workspace } from './workspace.ts'

// The action API's core side (actions.run): checks an action's arguments, asks the user in the chat before the heavy
// ones (creating a project, starting a session, allowing what Claude asked), then runs it with the commands the app
// already has. The actions of the client's own screen (composer, open a file or a screen) are not here.

// Who runs an action: the workspace, the chat it comes from, who asked (widget) and the client's name.
type Context = { workspace: Workspace; tab: Tab; source: ActionConfirmation['source']; by: string }
type Runner<Name extends CoreActionName> = (context: Context, args: CoreActionArgs<Name>) => Promise<unknown>

// Asks the user in the chat; throws action_denied unless they allow it.
async function confirmed(context: Context, action: CoreActionName, args: object, about?: ActionConfirmation['about']): Promise<void> {
  const allowed = await context.tab.confirmAction({ action, args: { ...args }, source: context.source, ...(about ? { about } : {}) })
  if (!allowed) throw new CoreError('action_denied', 'the user did not allow it')
}

// prompt.send: a message in the chat, as if typed.
const sendPrompt: Runner<'prompt.send'> = async ({ tab, by }, { text }) => {
  await tab.send({ queueId: randomUUID(), text, from: by })
  return {}
}

// request.answer: answers the chat's first request from Claude. Allowing a permission or a plan asks first; answering a
// question or denying does not. not_found when nothing waits for an answer.
const answerRequest: Runner<'request.answer'> = async (context, { decision, answers }) => {
  const request = context.tab.openRequests().find((open) => open.kind !== 'action')
  if (!request) throw new CoreError('not_found', 'no request waits for an answer in this chat')
  if (decision === 'allow' && request.kind !== 'question') await confirmed(context, 'request.answer', { decision }, { toolName: request.toolName, ...(request.title ? { title: request.title } : {}) })
  context.tab.answer(request.requestId, { decision, ...(answers ? { answers } : {}) }, context.by)
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
  const tabId = workspace.create(workspace.withDefaults({ tabId: randomUUID(), cwd: folder }))
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

// Runs one action for a chat. run: the actions.run arguments; by: the asking client's name. Returns the action's
// value; throws invalid_args (bad arguments), action_denied, or the errors of the command it uses.
export function runAction(workspace: Workspace, { tabId, action, args, source }: CommandArgs<'actions.run'>, by: string): Promise<unknown> {
  const parsed = CORE_ACTIONS[action].safeParse(args)
  if (!parsed.success) throw new CoreError('invalid_args', `${action}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'} ${issue.message}`).join('; ')}`)
  const runner = RUNNERS[action] as Runner<CoreActionName>
  return runner({ workspace, tab: workspace.tabOf(tabId), source, by }, parsed.data as never)
}

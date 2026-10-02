import { COMMANDS, LIMITS, type Cmd, type CommandArgs, type CommandName, type CommandResult, type ErrorCode, type Reply } from '@claude-wrap/protocol'
import { CoreError, messageOf } from './errors.ts'
import type { Send } from './stream.ts'
import type { Workspace } from './workspace.ts'

const DEFAULT_HISTORY_PAGE = 200

// One attached client.
export type Connection = { clientId: string; send: Send }
type Handler<N extends CommandName> = (args: CommandArgs<N>, connection: Connection, cmdId: string) => Promise<CommandResult<N>> | CommandResult<N>
export type Handlers = { [N in CommandName]: Handler<N> }

// Copies a tab's session (up to an item, if given) into a new tab next to it. Refused while a turn runs: the
// copy would contain a tool call without result, "running" forever.
async function fork(workspace: Workspace, { tabId, newTabId, upToItemId }: CommandArgs<'tab.fork'>): Promise<CommandResult<'tab.fork'>> {
  const tab = workspace.tabOf(tabId)
  if (tab.busy) throw new CoreError('session_busy', 'wait for the turn to end before forking')
  if (!tab.sessionId) throw new CoreError('not_found', 'nothing to fork yet: send a first message')
  const title = `${tab.title} (fork)`
  const upToMessageId = upToItemId ? tab.sourceUuidOf(upToItemId) : undefined
  const { sessionId } = await workspace.sdk.forkSession(tab.sessionId, { dir: tab.cwd, title, upToMessageId })
  const created = workspace.create({ tabId: newTabId, cwd: tab.cwd, resume: sessionId, title, model: tab.model, mode: tab.mode })
  workspace.reorder(created, [...workspace.tabs.keys()].indexOf(tabId) + 1)
  return { tabId: created }
}

// Stored sessions of a folder, newest first, with the tab that has each one open.
async function listSessions(workspace: Workspace, cwd: string): Promise<CommandResult<'sessions.list'>> {
  const sessions = await workspace.sdk.listSessions({ dir: cwd })
  return {
    sessions: sessions
      .sort((a, b) => b.lastModified - a.lastModified)
      .map((info) => ({
        sessionId: info.sessionId,
        title: info.customTitle || info.summary,
        lastModified: info.lastModified,
        gitBranch: info.gitBranch,
        tabId: workspace.tabOfSession(info.sessionId)?.tabId
      }))
  }
}

// Deletes a stored session. A tab that still references it refuses (session_busy), unless that tab is closing:
// then its process must exit first, or it could write the deleted file again.
async function deleteSession(workspace: Workspace, { cwd, sessionId }: CommandArgs<'sessions.delete'>): Promise<CommandResult<'sessions.delete'>> {
  const owner = workspace.tabOfSession(sessionId)
  if (owner && owner.status !== 'closing') throw new CoreError('session_busy', 'close the tab of this session first')
  await owner?.close()
  await workspace.sdk.deleteSession(sessionId, { dir: cwd })
  return {}
}

// The command handlers, one per protocol command, acting on the workspace.
export function createHandlers(workspace: Workspace): Handlers {
  const tabOf = (tabId: string) => workspace.tabOf(tabId)
  return {
    'tab.create': (init) => ({ tabId: workspace.create(init) }),
    'tab.close': async ({ tabId }) => (await workspace.close(tabId), {}),
    'tab.rename': async ({ tabId, title }) => (await tabOf(tabId).rename(title), {}),
    'tab.reorder': ({ tabId, index }) => (workspace.reorder(tabId, index), {}),
    'tab.fork': (args) => fork(workspace, args),
    'tab.restart': async ({ tabId }) => (await tabOf(tabId).restart(), {}),
    'tab.subscribe': async ({ tabId }, connection) => (await tabOf(tabId).subscribe(connection.send), {}),
    'tab.unsubscribe': ({ tabId }, connection) => (tabOf(tabId).unsubscribe(connection.send), {}),
    'tab.history': ({ tabId, beforeItemId, limit }) => tabOf(tabId).history(beforeItemId, limit ?? DEFAULT_HISTORY_PAGE),
    'tab.send': ({ tabId, text }, connection, cmdId) => {
      if (Buffer.byteLength(text) > LIMITS.sendTotalBytes) throw new CoreError('too_large', 'message too large')
      return tabOf(tabId).send(text, cmdId, connection.clientId)
    },
    'tab.unqueue': ({ tabId, queueId }) => (tabOf(tabId).unqueue(queueId), {}),
    'tab.interrupt': async ({ tabId }) => (await tabOf(tabId).interrupt(), {}),
    'tab.setModel': async ({ tabId, model }) => (await tabOf(tabId).setModel(model), {}),
    'tab.setMode': async ({ tabId, mode }) => (await tabOf(tabId).setMode(mode), {}),
    'tab.models': async ({ tabId }) => ({ models: await tabOf(tabId).models() }),
    'tab.commands': async ({ tabId }) => ({ commands: await tabOf(tabId).commands() }),
    'sessions.list': ({ cwd }) => listSessions(workspace, cwd),
    'sessions.rename': async ({ cwd, sessionId, title }) => {
      if (workspace.tabOfSession(sessionId)) throw new CoreError('session_busy', 'rename it from its tab')
      await workspace.sdk.renameSession(sessionId, title, { dir: cwd })
      return {}
    },
    'sessions.delete': (args) => deleteSession(workspace, args),
    'trust.check': ({ cwd }) => workspace.trust.check(cwd),
    'trust.grant': async ({ cwd }) => (await workspace.grantTrust(cwd), {}),
    'request.answer': ({ tabId, requestId, ...answer }, connection) => (tabOf(tabId).answer(requestId, answer, connection.clientId), {})
  }
}

// Validates and runs one command. Returns its reply frame (errors included).
export async function execute(handlers: Handlers, cmd: Cmd, connection: Connection): Promise<Reply> {
  try {
    const args = COMMANDS[cmd.name].args.safeParse(cmd.args)
    if (!args.success) throw new CoreError('invalid_args', args.error.message)
    const handler = handlers[cmd.name] as Handler<CommandName>
    return { t: 'reply', id: cmd.id, ok: true, result: await handler(args.data as never, connection, cmd.id) }
  } catch (error) {
    const code: ErrorCode = error instanceof CoreError ? error.code : 'internal'
    return { t: 'reply', id: cmd.id, ok: false, error: { code, message: messageOf(error) } }
  }
}

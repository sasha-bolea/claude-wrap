import { randomUUID } from 'node:crypto'
import { COMMANDS, LIMITS, type Cmd, type CommandArgs, type CommandName, type CommandResult, type ErrorCode, type Image, type Reply } from '@athome/protocol'
import { CoreError, messageOf } from './errors.ts'
import { deletable, listFiles, makeDir, moveFile, readFileFor, writeFileFor } from './files.ts'
import { createFolder, listFolders } from './folders.ts'
import type { Send } from './stream.ts'
import { MAX_AUTO_TITLE, cliTitle } from './tab.ts'
import { withinRoots } from './trustGate.ts'
import type { Workspace } from './workspace.ts'

const DEFAULT_HISTORY_PAGE = 200
// How many sessions the list of every folder's sessions shows at most (newest first).
const ALL_SESSIONS_LIMIT = 200

// One attached client. label: how other clients see it (device name on the server, else the clientId);
// deviceId: the paired device (remote only); visible: its page is on screen.
// watching: the tab whose chat it shows on screen.
export type Connection = { clientId: string; send: Send; label: string; deviceId?: string; visible: boolean; watching?: string }
type Handler<N extends CommandName> = (args: CommandArgs<N>, connection: Connection, cmdId: string) => Promise<CommandResult<N>> | CommandResult<N>
export type Handlers = { [N in CommandName]: Handler<N> }
// Commands the host implements itself (the remote server's device management).
export type HostCommands = Partial<Pick<Handlers, 'devices.list' | 'devices.pairStart' | 'devices.revoke' | 'push.config' | 'push.subscribe' | 'push.unsubscribe'>>

const notHere = () => {
  throw new CoreError('not_found', 'devices and push exist only on the remote server')
}

// Copies a tab's session (up to an item, if given) into a new tab next to it. Refused while a turn runs: the
// copy would contain a tool call without result, "running" forever.
async function fork(workspace: Workspace, { tabId, newTabId, upToItemId }: CommandArgs<'tab.fork'>): Promise<CommandResult<'tab.fork'>> {
  const tab = workspace.tabOf(tabId)
  if (tab.busy) throw new CoreError('session_busy', 'wait for the turn to end before forking')
  if (!tab.sessionId) throw new CoreError('not_found', 'nothing to fork yet: send a first message')
  const title = `${tab.title} (fork)`
  const upToMessageId = upToItemId ? tab.sourceUuidOf(upToItemId) : undefined
  const { sessionId } = await workspace.sdk.forkSession(tab.sessionId, { dir: tab.cwd, title, upToMessageId })
  const created = workspace.create({ tabId: newTabId, cwd: tab.cwd, resume: sessionId, title, model: tab.model, effort: tab.effort, mode: tab.mode })
  workspace.reorder(created, [...workspace.tabs.keys()].indexOf(tabId) + 1)
  return { tabId: created }
}

// Rewinds a tab (see Tab.rewind). Rewinding to the first message cuts nothing: the old session stays as it is (a past
// session, its tab open) and a fresh tab in the same folder, with the same model, effort, mode and account, gets the prompt.
async function rewind(workspace: Workspace, { tabId, itemId, mode }: CommandArgs<'tab.rewind'>): Promise<CommandResult<'tab.rewind'>> {
  const tab = workspace.tabOf(tabId)
  const { startOver, ...outcome } = await tab.rewind(itemId, mode)
  if (!startOver) return outcome
  const created = workspace.create({ tabId: randomUUID(), cwd: tab.cwd, model: tab.model, effort: tab.effort, mode: tab.mode, account: tab.accountId })
  workspace.reorder(created, [...workspace.tabs.keys()].indexOf(tabId) + 1)
  return { ...outcome, newTabId: created }
}

// Stored sessions of a folder, or (no cwd) of every folder inside the roots, newest first, with their folder and the
// tab that has each one open.
async function listSessions(workspace: Workspace, cwd: string | undefined): Promise<CommandResult<'sessions.list'>> {
  const sessions = cwd
    ? await workspace.sdk.listSessions({ dir: cwd })
    : (await workspace.sdk.listSessions({ limit: ALL_SESSIONS_LIMIT })).filter((info) => info.cwd && withinRoots(info.cwd, workspace.allowedRoots))
  return {
    sessions: sessions
      .sort((a, b) => b.lastModified - a.lastModified)
      .map((info) => ({
        sessionId: info.sessionId,
        title: cliTitle(info) ?? info.firstPrompt?.slice(0, MAX_AUTO_TITLE) ?? info.summary.slice(0, MAX_AUTO_TITLE),
        lastModified: info.lastModified,
        cwd: info.cwd,
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

// Refuses a message over the protocol limits (LIMITS): too many images, an image or the whole message too big.
function checkSize(text: string, images: Image[]): void {
  const imageBytes = images.map((image) => Math.floor((image.data.length * 3) / 4))
  if (images.length > LIMITS.images) throw new CoreError('too_large', `at most ${LIMITS.images} images`)
  if (imageBytes.some((bytes) => bytes > LIMITS.imageBytes)) throw new CoreError('too_large', 'image too large')
  if (Buffer.byteLength(text) + imageBytes.reduce((sum, bytes) => sum + bytes, 0) > LIMITS.sendTotalBytes) throw new CoreError('too_large', 'message too large')
}

// The command handlers, one per protocol command, acting on the workspace; host: the host's own commands.
export function createHandlers(workspace: Workspace, host: HostCommands = {}): Handlers {
  const tabOf = (tabId: string) => workspace.tabOf(tabId)
  // The folder of a file command: the tab's (trusted, as for its session) or a folder of the Home (inside the roots).
  const folderOf = ({ tabId, folder }: { tabId?: string; folder?: string }) => (tabId ? tabOf(tabId).folder() : workspace.folderOf(folder!))
  const appTrash = () => {
    if (!workspace.trash) throw new CoreError('not_found', 'no app trash on this backend')
    return workspace.trash
  }
  // Notes are keyed by the canonical folder; every client hears about a change.
  const notesChanged = (cwd: string) => workspace.stream.emit({ type: 'notes.changed', cwd })
  return {
    'tab.create': (init) => ({ tabId: workspace.create(workspace.withDefaults(init)) }),
    'tab.close': async ({ tabId }) => (await workspace.close(tabId), {}),
    'tab.rename': async ({ tabId, title }) => (await tabOf(tabId).rename(title), {}),
    'tab.reorder': ({ tabId, index }) => (workspace.reorder(tabId, index), {}),
    'tab.fork': (args) => fork(workspace, args),
    'tab.restart': async ({ tabId }) => (await tabOf(tabId).restart(), {}),
    'tab.subscribe': async ({ tabId }, connection) => (await tabOf(tabId).subscribe(connection.send), {}),
    'tab.unsubscribe': ({ tabId }, connection) => (tabOf(tabId).unsubscribe(connection.send), {}),
    'tab.history': ({ tabId, beforeItemId, limit }) => tabOf(tabId).history(beforeItemId, limit ?? DEFAULT_HISTORY_PAGE),
    'tab.send': async ({ tabId, text, images, pastes }, connection, cmdId) => {
      checkSize(text, images ?? [])
      await tabOf(tabId).send({ queueId: cmdId, text, from: connection.label, images, pastes })
      return {}
    },
    'tab.queueAdd': ({ tabId, text, images, pastes }, connection, cmdId) => {
      checkSize(text, images ?? [])
      tabOf(tabId).queueAdd({ queueId: cmdId, text, from: connection.label, images, pastes })
      return {}
    },
    'tab.queueEdit': ({ tabId, queueId, text }) => (tabOf(tabId).queueEdit(queueId, text), {}),
    'tab.queueMove': ({ tabId, queueId, index }) => (tabOf(tabId).queueMove(queueId, index), {}),
    'tab.unqueue': ({ tabId, queueId }) => (tabOf(tabId).unqueue(queueId), {}),
    'tab.queueHold': ({ tabId, queueId }) => tabOf(tabId).holdQueued(queueId),
    'tab.sendNow': async ({ tabId, queueId }) => (await tabOf(tabId).sendNow(queueId), {}),
    'tab.queuePause': ({ tabId, paused }) => (tabOf(tabId).setQueuePaused(paused), {}),
    'tab.shell': ({ tabId, command }, _connection, cmdId) => tabOf(tabId).shell(command, cmdId),
    'tab.suggestFiles': async ({ tabId, query }) => ({ paths: await tabOf(tabId).suggestFiles(query) }),
    'blob.get': ({ tabId, imageId }) => {
      const image = tabOf(tabId).transcript.blob(imageId)
      if (!image) throw new CoreError('not_found', 'image not found')
      return image
    },
    'tab.interrupt': async ({ tabId }) => (await tabOf(tabId).interrupt(), {}),
    'tab.sendPendingNow': async ({ tabId, itemId }) => (await tabOf(tabId).sendPendingNow(itemId), {}),
    'tab.unsendPending': ({ tabId, itemId }) => tabOf(tabId).unsendPending(itemId),
    'tab.setAccount': async ({ tabId, accountId }) => {
      await workspace.accounts.loaded
      if (accountId && !workspace.accounts.has(accountId)) throw new CoreError('not_found', `no account ${accountId}`)
      tabOf(tabId)
      await workspace.useAccount(accountId)
      return {}
    },
    'accounts.add': async ({ name, token }) => ({ accountId: await workspace.accounts.add(name, token) }),
    'accounts.remove': async ({ accountId }) => (await workspace.removeAccount(accountId), {}),
    'accounts.rename': async ({ accountId, name }) => (await workspace.accounts.rename(accountId, name), {}),
    'accounts.setDefault': async ({ accountId }) => {
      await workspace.accounts.loaded
      if (accountId && !workspace.accounts.has(accountId)) throw new CoreError('not_found', `no account ${accountId}`)
      await workspace.useAccount(accountId)
      return {}
    },
    'tabs.continue': async ({ text }, connection) => (await workspace.continueStopped(text, connection.label), {}),
    'tab.setModel': async ({ tabId, model }) => (await tabOf(tabId).setModel(model), {}),
    'tab.setEffort': async ({ tabId, effort }) => (await tabOf(tabId).setEffort(effort), {}),
    'tab.setMode': async ({ tabId, mode }) => (await tabOf(tabId).setMode(mode), {}),
    'tab.models': async ({ tabId }) => ({ models: await tabOf(tabId).models() }),
    'tab.commands': async ({ tabId }) => ({ commands: await tabOf(tabId).commands() }),
    'tab.context': ({ tabId }) => tabOf(tabId).contextUsage(),
    'tab.usage': ({ tabId }) => tabOf(tabId).usage(),
    'tab.rewindPoints': ({ tabId }) => ({ points: tabOf(tabId).rewindPoints() }),
    'tab.rewindPreview': ({ tabId, itemId }) => tabOf(tabId).rewindPreview(itemId),
    'tab.rewind': (args) => rewind(workspace, args),
    'settings.setAutoCompactWindow': async ({ tokens }) => (await workspace.setAutoCompactWindow(tokens), {}),
    'settings.setDefaultEffort': async ({ effort }) => (await workspace.setDefaultEffort(effort), {}),
    'settings.setDefaultMode': async ({ mode }) => (await workspace.setDefaultMode(mode), {}),
    'tab.refreshGauges': async ({ tabId }) => (await workspace.refreshGauges(tabId), {}),
    'sessions.list': ({ cwd }) => listSessions(workspace, cwd),
    'sessions.rename': async ({ cwd, sessionId, title }) => {
      if (workspace.tabOfSession(sessionId)) throw new CoreError('session_busy', 'rename it from its tab')
      await workspace.sdk.renameSession(sessionId, title, { dir: cwd })
      return {}
    },
    'sessions.delete': (args) => deleteSession(workspace, args),
    'prompts.history': async ({ cwd }) => ({ prompts: await workspace.prompts.list(cwd) }),
    'folders.list': ({ path }) => listFolders(path, workspace.allowedRoots, new Set(workspace.projects())),
    'folders.create': async ({ path, name, project }) => {
      const created = await createFolder(path, name, workspace.allowedRoots)
      if (project) await workspace.setProject(created.path, true)
      return created
    },
    'folders.setProject': async ({ path, project }) => (await workspace.setProject(path, project), {}),
    'folders.add': async ({ path }) => ({ path: await workspace.addFolder(path) }),
    'folders.remove': async ({ path }) => (await workspace.removeFolder(path), {}),
    'folders.delete': async ({ path, closeSessions }) => (await workspace.deleteFolder(path, closeSessions), {}),
    'files.list': async (args) => ({ entries: await listFiles(await folderOf(args), args.path) }),
    'files.read': async (args) => readFileFor(await folderOf(args), args.path, args.download),
    'files.write': async (args) => ({ path: await writeFileFor(await folderOf(args), args.path, args.data, { overwrite: args.overwrite, attachment: args.attachment }) }),
    'files.mkdir': async (args) => (await makeDir(await folderOf(args), args.path), {}),
    'files.rename': async (args) => (await moveFile(await folderOf(args), args.from, args.to), {}),
    'files.delete': async (args) => (await workspace.discard(await deletable(await folderOf(args), args.path)), {}),
    'trash.list': async ({ under }) => ({ items: (await workspace.trash?.list(under)) ?? [] }),
    'trash.restore': async ({ id }) => ({ path: await workspace.restore(id) }),
    'trash.delete': async ({ id }) => (await appTrash().delete(id), {}),
    'trash.empty': async ({ under }) => (await workspace.trash?.empty(under), {}),
    'notes.list': async ({ cwd }) => ({ notes: await workspace.notes.list(await workspace.folderOf(cwd)) }),
    'notes.save': async ({ cwd, noteId, text }) => {
      const folder = await workspace.folderOf(cwd)
      const note = await workspace.notes.save(folder, noteId, text)
      notesChanged(folder)
      return { note }
    },
    'notes.delete': async ({ cwd, noteId }) => {
      const folder = await workspace.folderOf(cwd)
      await workspace.notes.delete(folder, noteId)
      notesChanged(folder)
      return {}
    },
    'palettes.save': async ({ paletteId, name, colors }) => ({ palette: await workspace.palettes.save(paletteId, name, colors) }),
    'palettes.delete': async ({ paletteId }) => workspace.palettes.delete(paletteId).then(() => ({})),
    'devices.list': notHere,
    'devices.pairStart': notHere,
    'devices.revoke': notHere,
    'push.config': notHere,
    'push.subscribe': notHere,
    'push.unsubscribe': notHere,
    ...host,
    // A chat on screen is a chat looked at: it leaves the notification count.
    'client.visibility': ({ visible }, connection) => {
      connection.visible = visible
      if (visible && connection.watching) workspace.seen(connection.watching)
      return {}
    },
    'client.watch': ({ tabId }, connection) => {
      connection.watching = tabId
      if (tabId && connection.visible) workspace.seen(tabId)
      return {}
    },
    'terminal.open': async ({ tabId, folder, cols, rows }) => ({ terminalId: await workspace.terminals.open(await folderOf({ tabId, folder }), cols, rows, tabId) }),
    'terminal.subscribe': ({ terminalId }, connection) => (workspace.terminals.subscribe(terminalId, connection.send), {}),
    'terminal.unsubscribe': ({ terminalId }, connection) => (workspace.terminals.unsubscribe(terminalId, connection.send), {}),
    'terminal.input': ({ terminalId, data }) => (workspace.terminals.input(terminalId, data), {}),
    'terminal.resize': ({ terminalId, cols, rows }) => (workspace.terminals.resize(terminalId, cols, rows), {}),
    'terminal.close': ({ terminalId }) => (workspace.terminals.close(terminalId), {}),
    // Browser: not yet implemented.
    'browser.subscribe': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.unsubscribe': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.navigate': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.back': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.forward': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.reload': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.tabNew': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.tabSelect': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.tabClose': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.pointer': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.wheel': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.key': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.text': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.copySelection': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.viewport': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.dialogAnswer': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'browser.setHold': () => { throw new CoreError('not_found', 'browser not yet implemented') },
    'trust.check': ({ cwd }) => workspace.trust.check(cwd),
    'trust.grant': async ({ cwd }) => (await workspace.grantTrust(cwd), {}),
    'request.answer': ({ tabId, requestId, ...answer }, connection) => (tabOf(tabId).answer(requestId, answer, connection.label), {})
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

import { join } from 'node:path'
import { LIMITS, PROTOCOL_VERSION, WORKSPACE_STREAM, clientFrameSchema, type Channel, type Cmd, type CoreFrame, type ErrorCode, type Hello, type Palette, type Welcome } from '@athome/protocol'
import { createHandlers, execute, type Connection, type Handlers } from './commands.ts'
import type { CoreConfig } from './config.ts'
import { sweepOrphans } from './process.ts'
import { ReplyCache } from './replyCache.ts'
import { StateStore } from './state.ts'
import type { Send } from './stream.ts'
import { readVersions } from './versions.ts'
import { Workspace } from './workspace.ts'

export type { CoreConfig, Notice, SdkApi } from './config.ts'

// Who is on the other end of a channel, when the host knows (the remote server after token authentication).
export type Identity = { deviceId: string; label: string }

export interface Core {
  // Resolves once the state is loaded and a previous crash's orphans are swept; hello is answered only after.
  ready: Promise<void>
  attach(channel: Channel, identity?: Identity): void
  // Closes every tab (quit). Resolves when processes are gone, at most after a few seconds.
  closeAll(): Promise<void>
  // The saved colour palettes (the remote host shows them to a device being set up, before it is paired).
  palettes(): Promise<Palette[]>
}

type Runtime = { workspace: Workspace; handlers: Handlers }

// Loads state.json, kills what a dead core left running (then forgets it), restores the tabs dormant.
async function start(config: CoreConfig): Promise<Runtime> {
  const store = await StateStore.load(config.stateDir && join(config.stateDir, 'state.json'))
  await sweepOrphans(store.data.livePids)
  await store.update((data) => (data.livePids = []))
  const workspace = new Workspace(config, store)
  return { workspace, handlers: createHandlers(workspace, config.hostCommands) }
}

// Creates the backend core: owns tabs, sessions, transcripts, queues and requests; clients attach channels.
export function createCore(config: CoreConfig): Core {
  // Attached clients that said hello (their visibility goes with every notice).
  const greeted = new Set<Connection>()
  const visibleDevices = () => [...new Set([...greeted].flatMap((connection) => (connection.visible && connection.deviceId ? [connection.deviceId] : [])))]
  const notifier = config.notifier
  const watching = (tabId: string) => [...greeted].some((connection) => connection.visible && connection.watching === tabId)
  const runtime = start({ ...config, watching, notifier: notifier && ((notice) => notifier({ ...notice, visibleDevices: visibleDevices() })) })
  const replies = new ReplyCache()
  const welcome: Welcome = { t: 'welcome', protocolVersion: PROTOCOL_VERSION, backendId: config.backendId, backendKind: config.backendKind, ...readVersions(), limits: LIMITS }

  // Runs a command once per (clientId, id): a retried id gets the first reply.
  function runCommand({ handlers }: Runtime, cmd: Cmd, connection: Connection): void {
    let reply = replies.get(connection.clientId, cmd.id)
    if (!reply) {
      reply = execute(handlers, cmd, connection)
      replies.set(connection.clientId, cmd.id, reply)
    }
    void reply.then((frame) => connection.send(frame))
  }

  // After welcome: workspace and resumed tab and terminal streams get a replay, a reset, or `gone`.
  async function resumeStreams({ workspace }: Runtime, hello: Hello, connection: Connection): Promise<void> {
    workspace.stream.attach(connection.send, hello.resume[WORKSPACE_STREAM])
    for (const [stream, position] of Object.entries(hello.resume)) {
      if (stream === WORKSPACE_STREAM) continue
      const tab = workspace.tabOfStream(stream)
      const terminal = tab ? undefined : workspace.terminals.streamOf(stream)
      if (tab) await tab.subscribe(connection.send, position)
      else if (terminal) terminal.attach(connection.send, position)
      else connection.send({ t: 'gone', stream })
    }
  }

  // Attaches one client connection: the first frame must be a valid hello of the same protocol major.
  // Frames wait for the startup to finish, in arrival order.
  function attach(channel: Channel, identity?: Identity): void {
    let connection: Connection | undefined
    const send: Send = (frame: CoreFrame) => channel.send(frame)
    const refuse = (code: ErrorCode, message: string) => {
      send({ t: 'fatal', error: { code, message } })
      channel.close()
    }
    const handle = (started: Runtime, raw: unknown) => {
      const parsed = clientFrameSchema.safeParse(raw)
      if (!parsed.success) return refuse('invalid_args', 'invalid frame')
      const frame = parsed.data
      if (frame.t === 'hello') {
        if (connection) return refuse('invalid_args', 'hello already received')
        if (frame.protocolVersion !== PROTOCOL_VERSION) {
          return refuse('incompatible_protocol', `core speaks protocol ${PROTOCOL_VERSION}, client ${frame.protocolVersion}`)
        }
        connection = { clientId: frame.clientId, send, label: identity?.label ?? frame.clientId, deviceId: identity?.deviceId, visible: frame.visible }
        greeted.add(connection)
        send(welcome)
        return void resumeStreams(started, frame, connection)
      }
      if (!connection) return refuse('invalid_args', 'hello expected first')
      if (frame.t === 'ping') return send({ t: 'pong', n: frame.n })
      runCommand(started, frame, connection)
    }

    channel.onMessage((raw) => void runtime.then((started) => handle(started, raw)))
    channel.onClose(() =>
      void runtime.then(({ workspace }) => {
        if (connection) greeted.delete(connection)
        workspace.stream.detach(send)
        for (const tab of workspace.tabs.values()) tab.unsubscribe(send)
        workspace.terminals.detachAll(send)
      })
    )
  }

  const palettes = () => runtime.then(async ({ workspace }) => (await workspace.palettes.loaded, workspace.palettes.list()))
  return { ready: runtime.then(() => undefined), attach, closeAll: () => runtime.then(({ workspace }) => workspace.closeAll()), palettes }
}

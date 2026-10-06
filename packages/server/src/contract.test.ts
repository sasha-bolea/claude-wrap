// Protocol contract: the real core and the real client, over the in-memory transport and over the real
// WebSocket server (Origin/Host checks and device token included). MessagePort is covered by the desktop e2e.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, createChannelPair, type Channel, type CoreFrame } from '@athome/protocol'
import { Connection, openWebSocket, type StoreState } from '@athome/client'
import { createCore, type Core, type CoreConfig } from '@athome/core'
import { createFakeSdk, sdk, type FakeSdk } from '@athome/core/testing'
import { DeviceStore, createPairingCode } from './devices.ts'
import { startServer, type RunningServer } from './server.ts'

const CWD = mkdtempSync(join(tmpdir(), 'cw-contract-'))
const HEADERS = { Host: 'contract.test:443', Origin: 'https://contract.test' }

let fake: FakeSdk
let core: Core
let connection: Connection

// What a test controls on the link: drop it, keep it offline, or lose the next frame matching loseNext.
type LinkState = { current?: Channel; offline: boolean; opens: number; loseNext?: (frame: CoreFrame) => boolean }
type Link = { state: LinkState; openChannel: () => Promise<Channel>; drop: () => void }

// A frame matching state.loseNext never arrives: the connection drops right when core sends it.
function lossy(channel: Channel, state: LinkState, close: () => void): Channel {
  return {
    ...channel,
    send: (frame) => {
      if (!state.loseNext?.(frame as CoreFrame)) return channel.send(frame)
      state.loseNext = undefined
      close()
    }
  }
}

// In-memory: a channel pair per connection, attached to the current core.
function memoryLink(): Link {
  const state: LinkState = { offline: false, opens: 0 }
  return {
    state,
    openChannel: async () => {
      if (state.offline) throw new Error('offline')
      const [clientEnd, coreEnd] = createChannelPair()
      core.attach(lossy(coreEnd, state, () => clientEnd.close()))
      state.current = clientEnd
      state.opens++
      return clientEnd
    },
    drop: () => state.current?.close()
  }
}

// WebSocket: a real server on an ephemeral port, attaching to the current core; one paired device.
let server: RunningServer | undefined
let token = ''
let wsState: LinkState | undefined
async function startWebSocketServer(): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), 'cw-contract-state-'))
  const devices = await DeviceStore.load(stateDir)
  const { code } = await createPairingCode(stateDir, 'contract')
  token = (await devices.completePairing(code))!.token
  server = await startServer({
    attach: (channel, identity) => core.attach(channel, identity),
    devices,
    port: 0,
    allowedOrigins: [HEADERS.Origin],
    allowedHosts: [HEADERS.Host],
    wrapChannel: (channel) => (wsState ? lossy(channel, wsState, () => channel.close()) : channel),
    log: () => undefined
  })
}
function webSocketLink(): Link {
  const state: LinkState = { offline: false, opens: 0 }
  wsState = state
  return {
    state,
    openChannel: async () => {
      if (state.offline) throw new Error('offline')
      const channel = await openWebSocket(`ws://127.0.0.1:${server!.port}/ws`, (url) => new WebSocket(url, { headers: HEADERS }))
      state.current = channel
      state.opens++
      return channel
    },
    drop: () => state.current?.close()
  }
}

const TRANSPORTS = [
  { name: 'in-memory', link: memoryLink, start: async () => undefined, stop: async () => undefined },
  { name: 'websocket', link: webSocketLink, start: startWebSocketServer, stop: async () => void (await server?.close()) }
]
let transport = TRANSPORTS[0]!
const link = () => transport.link()

const makeCore = (overrides: Partial<CoreConfig> = {}) =>
  createCore({ backendId: 'b1', backendKind: 'local', sdk: fake, coalesceMs: 1, ...overrides })

// Resolves when the store satisfies predicate.
async function until(predicate: (state: StoreState) => boolean, timeoutMs = 2000): Promise<StoreState> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(connection.store.getSnapshot())) {
    if (Date.now() > deadline) throw new Error(`until timed out: ${JSON.stringify(connection.store.getSnapshot()).slice(0, 400)}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return connection.store.getSnapshot()
}

const userItems = (state: StoreState) => state.transcripts['t1']?.items.filter((item) => item.kind === 'user') ?? []

// A connection over the link (with the device token, ignored in memory).
function connectOver(net: Link): Connection {
  return new Connection({ openChannel: net.openChannel, clientId: 'c1', token, retry: { initialMs: 2, maxMs: 10 } })
}

// Connects, creates and subscribes tab t1, starts its fake process with a first message.
async function liveTab(net: Link) {
  connection = connectOver(net)
  connection.start()
  await connection.request('trust.grant', { cwd: CWD })
  await connection.request('tab.create', { tabId: 't1', cwd: CWD })
  await connection.subscribeTab('t1')
  await connection.request('tab.send', { tabId: 't1', text: 'first' })
  await fake.last().waitForInput(1)
  return fake.last()
}

describe.each(TRANSPORTS)('protocol contract ($name)', (current) => {
  beforeEach(async () => {
    transport = current
    fake = createFakeSdk()
    core = makeCore()
    await current.start()
  })
  afterEach(async () => {
    connection?.close()
    wsState = undefined
    await core.closeAll()
    await current.stop()
  })

  it('handshake: welcome carries the backend identity and the real versions', async () => {
    const net = link()
    connection = connectOver(net)
    connection.start()
    const state = await until((s) => s.status === 'connected' && s.tabs !== undefined)
    expect(state.welcome).toMatchObject({ protocolVersion: PROTOCOL_VERSION, backendId: 'b1', sdkVersion: '0.3.287', cliVersion: '2.1.287' })
    expect(state.welcome?.coreVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it.runIf(current.name === 'in-memory')('version mismatch: core answers incompatible_protocol and closes', async () => {
    const [clientEnd, coreEnd] = createChannelPair()
    const frames: unknown[] = []
    let closed = false
    clientEnd.onMessage((frame) => frames.push(frame))
    clientEnd.onClose(() => (closed = true))
    core.attach(coreEnd)
    clientEnd.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION + 1, clientId: 'c', visible: true, resume: {} })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(frames).toEqual([{ t: 'fatal', error: { code: 'incompatible_protocol', message: expect.any(String) } }])
    expect(closed).toBe(true)
  })

  it('a drop is followed by a replay of what was missed: nothing lost, nothing duplicated', async () => {
    const net = link()
    const session = await liveTab(net)
    net.state.offline = true
    net.drop()
    session.emit(sdk.messageStart('m1'), sdk.blockStart(0, { type: 'text', text: '' }), sdk.textDelta(0, 'while '), sdk.textDelta(0, 'away'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    net.state.offline = false
    // The replay arrives one event at a time: wait for the whole text (a lost delta times out here).
    const state = await until((s) => {
      const last = s.transcripts['t1']?.items.at(-1)
      return s.status === 'connected' && last?.itemId === 'm1:0' && 'text' in last && last.text === 'while away'
    })
    expect(state.transcripts['t1']?.items.map((item) => ('text' in item ? item.text : item.kind))).toEqual(['first', 'while away'])
  })

  it('a terminal: listed in the store, its output reaches the sink once, also across a drop', async () => {
    const net = link()
    connection = connectOver(net)
    connection.start()
    const { terminalId } = await connection.request('terminal.open', { folder: CWD, cols: 80, rows: 24 })
    await until((state) => state.terminals.some((terminal) => terminal.terminalId === terminalId))
    let text = ''
    const stop = connection.subscribeTerminal(terminalId, { reset: (snapshot) => (text = snapshot.screen), output: (data) => (text += data), exit: () => undefined })
    await connection.request('terminal.input', { terminalId, data: 'echo before-"d"rop\r' })
    await until(() => text.includes('before-drop'), 5000)
    net.state.offline = true
    net.drop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    net.state.offline = false
    await until((state) => state.status === 'connected')
    await connection.request('terminal.input', { terminalId, data: 'echo after-"d"rop\r' })
    await until(() => text.includes('after-drop'), 5000)
    expect(text.split('before-drop').length - 1).toBe(1)
    stop()
  })

  it('when the missed events fell out of the ring, the stream is reset instead', async () => {
    core = makeCore({ ring: { events: 3, bytes: 1_000_000 } })
    const net = link()
    const session = await liveTab(net)
    net.state.offline = true
    net.drop()
    for (let n = 0; n < 6; n++) session.emit(sdk.localOutput(`line ${n}`))
    await new Promise((resolve) => setTimeout(resolve, 10))
    net.state.offline = false
    const state = await until((s) => s.status === 'connected' && s.transcripts['t1']?.items.length === 7)
    expect(state.transcripts['t1']?.items.at(-1)).toMatchObject({ kind: 'localCommandOutput', text: 'line 5' })
  })

  it('a restarted core resets the streams (new epoch) and drops tabs it no longer has', async () => {
    const net = link()
    await liveTab(net)
    await core.closeAll()
    core = makeCore()
    net.drop()
    const state = await until((s) => s.status === 'connected' && s.tabs?.length === 0)
    expect(state.transcripts['t1']).toBeUndefined()
  })

  it('a drop after tab.send and before its reply still yields exactly one user item', async () => {
    const net = link()
    await liveTab(net)
    fake.last().emit(sdk.success())
    await until((s) => s.tabs?.[0]?.status === 'idle')
    net.state.loseNext = (frame) => frame.t === 'reply'
    const reply = await connection.request('tab.send', { tabId: 't1', text: 'second' })
    expect(reply).toEqual({})
    expect(net.state.opens).toBe(2)
    const state = await until((s) => userItems(s).length === 2)
    expect(userItems(state).map((item) => item.kind === 'user' && item.text)).toEqual(['first', 'second'])
    expect(fake.last().received).toHaveLength(2)
  })

  it('commands issued while offline are sent once after reconnecting', async () => {
    const net = link()
    const session = await liveTab(net)
    net.state.offline = true
    net.drop()
    await until((s) => s.status === 'offline')
    const queued = [connection.request('tab.queueAdd', { tabId: 't1', text: 'q1' }), connection.request('tab.queueAdd', { tabId: 't1', text: 'q2' })]
    net.state.offline = false
    expect(await Promise.all(queued)).toEqual([{}, {}])
    const state = await until((s) => s.tabs?.[0]?.queue.length === 2)
    expect(state.tabs?.[0]?.queue.map((message) => message.text)).toEqual(['q1', 'q2'])
    expect(session.received).toHaveLength(1)
  })
})

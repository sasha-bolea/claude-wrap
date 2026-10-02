// Protocol contract: the real core and the real client over the in-memory transport.
// (The same suite runs over WebSocket when the server exists, Phase 3; MessagePort is covered by the desktop e2e.)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, createChannelPair, type Channel, type CoreFrame } from '@claude-wrap/protocol'
import { Connection, type StoreState } from '@claude-wrap/client'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { sdk } from './testing/messages.ts'

const CWD = mkdtempSync(join(tmpdir(), 'cw-contract-'))

let fake: FakeSdk
let core: Core
let connection: Connection

// Switchable link between the connection and the current core: drop(), go offline, or lose one frame.
function link() {
  const state = { current: undefined as Channel | undefined, offline: false, opens: 0, loseNext: undefined as ((frame: CoreFrame) => boolean) | undefined }
  return {
    state,
    openChannel: async () => {
      if (state.offline) throw new Error('offline')
      const [clientEnd, coreEnd] = createChannelPair()
      // A frame matching loseNext never arrives: the connection drops right when core sends it.
      const lossy: Channel = {
        ...coreEnd,
        send: (frame) => {
          if (state.loseNext?.(frame as CoreFrame)) {
            state.loseNext = undefined
            clientEnd.close()
          } else coreEnd.send(frame)
        }
      }
      core.attach(lossy)
      state.current = clientEnd
      state.opens++
      return clientEnd
    },
    drop: () => state.current?.close()
  }
}

const makeCore = (overrides: Partial<CoreConfig> = {}) =>
  createCore({ backendId: 'b1', backendKind: 'local', sdk: fake, coalesceMs: 1, ...overrides })

// Resolves when the store satisfies predicate.
async function until(predicate: (state: StoreState) => boolean, timeoutMs = 1000): Promise<StoreState> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(connection.store.getSnapshot())) {
    if (Date.now() > deadline) throw new Error(`until timed out: ${JSON.stringify(connection.store.getSnapshot()).slice(0, 400)}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return connection.store.getSnapshot()
}

const userItems = (state: StoreState) => state.transcripts['t1']?.items.filter((item) => item.kind === 'user') ?? []

// Connects, creates and subscribes tab t1, starts its fake process with a first message.
async function liveTab(net: ReturnType<typeof link>) {
  connection = new Connection({ openChannel: net.openChannel, clientId: 'c1', retry: { initialMs: 2, maxMs: 10 } })
  connection.start()
  await connection.request('trust.grant', { cwd: CWD })
  await connection.request('tab.create', { tabId: 't1', cwd: CWD })
  await connection.subscribeTab('t1')
  await connection.request('tab.send', { tabId: 't1', text: 'first' })
  await fake.last().waitForInput(1)
  return fake.last()
}

beforeEach(() => {
  fake = createFakeSdk()
  core = makeCore()
})
afterEach(async () => {
  connection?.close()
  await core.closeAll()
})

describe('protocol contract (in-memory)', () => {
  it('handshake: welcome carries the backend identity and the real versions', async () => {
    const net = link()
    connection = new Connection({ openChannel: net.openChannel, clientId: 'c1' })
    connection.start()
    const state = await until((s) => s.status === 'connected' && s.tabs !== undefined)
    expect(state.welcome).toMatchObject({ protocolVersion: PROTOCOL_VERSION, backendId: 'b1', backendKind: 'local', sdkVersion: '0.3.287', cliVersion: '2.1.287' })
    expect(state.welcome?.coreVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('version mismatch: core answers incompatible_protocol and closes', async () => {
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
    const state = await until((s) => s.status === 'connected' && s.transcripts['t1']?.items.at(-1)?.itemId === 'm1:0')
    expect(state.transcripts['t1']?.items.map((item) => ('text' in item ? item.text : item.kind))).toEqual(['first', 'while away'])
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
    expect(reply).toEqual({ queued: false })
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
    const queued = [connection.request('tab.send', { tabId: 't1', text: 'q1' }), connection.request('tab.send', { tabId: 't1', text: 'q2' })]
    net.state.offline = false
    expect(await Promise.all(queued)).toEqual([{ queued: true }, { queued: true }])
    const state = await until((s) => s.tabs?.[0]?.queue.length === 2)
    expect(state.tabs?.[0]?.queue.map((message) => message.text)).toEqual(['q1', 'q2'])
    expect(session.received).toHaveLength(1)
  })
})

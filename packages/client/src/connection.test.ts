// Connection against a scripted core (raw frames), so client behaviour is tested without the real core.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PING_INTERVAL_MS, PROTOCOL_VERSION, createChannelPair, type Channel, type TabMeta } from '@athome/protocol'
import { ClientError, Connection } from './index.ts'

const WELCOME = {
  t: 'welcome',
  protocolVersion: PROTOCOL_VERSION,
  backendId: 'b',
  coreVersion: '0.0.1',
  sdkVersion: '0.3.287',
  cliVersion: '2.1.287',
  backendKind: 'local',
  limits: { sendTotalBytes: 1, imageBytes: 1, images: 1, previewBytes: 1, fileBytes: 1 }
}
const TAB: TabMeta = { tabId: 't1', title: 'demo', cwd: 'C:/demo', status: 'dormant', mode: 'default', queue: [], pendingRequests: 0 }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// A scripted core: every channel the connection opens is recorded with the frames it received.
function scriptedCore() {
  const links: { core: Channel; received: Record<string, unknown>[] }[] = []
  return {
    links,
    openChannel: async () => {
      const [client, core] = createChannelPair()
      const link = { core, received: [] as Record<string, unknown>[] }
      core.onMessage((frame) => link.received.push(frame as Record<string, unknown>))
      links.push(link)
      return client
    },
    last: () => links.at(-1)!
  }
}

let connection: Connection | undefined
afterEach(() => {
  connection?.close()
  vi.useRealTimers()
})

// A connection over a scripted core, already past hello/welcome with an empty workspace.
async function connected() {
  const core = scriptedCore()
  connection = new Connection({ openChannel: core.openChannel, clientId: 'c1', retry: { initialMs: 1, maxMs: 4 } })
  connection.start()
  await tick()
  core.last().core.send(WELCOME)
  core.last().core.send({ t: 'reset', stream: 'workspace', epoch: 'e1', seq: 0, snapshot: { kind: 'workspace', tabs: [TAB], home: { kind: 'added', folders: [] }, projects: [], accounts: [] } })
  await tick()
  return { core, connection }
}

describe('Connection', () => {
  it('says hello, then exposes welcome and the workspace in the store', async () => {
    const { core, connection } = await connected()
    expect(core.last().received[0]).toMatchObject({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'c1', resume: {} })
    expect(connection.store.getSnapshot()).toMatchObject({ status: 'connected', welcome: { cliVersion: '2.1.287' }, tabs: [TAB] })
  })

  it('resolves a request with its validated result and rejects with the protocol error code', async () => {
    const { core, connection } = await connected()
    const created = connection.request('tab.create', { tabId: 't2', cwd: 'C:/x' })
    const failed = connection.request('tab.close', { tabId: 'nope' })
    await tick()
    const [createCmd, closeCmd] = core.last().received.slice(1) as { id: string }[]
    core.last().core.send({ t: 'reply', id: createCmd!.id, ok: true, result: { tabId: 't2' } })
    core.last().core.send({ t: 'reply', id: closeCmd!.id, ok: false, error: { code: 'not_found', message: 'no tab' } })
    expect(await created).toEqual({ tabId: 't2' })
    await expect(failed).rejects.toBeInstanceOf(ClientError)
    await expect(failed).rejects.toMatchObject({ code: 'not_found' })
  })

  it('applies tab events after the reset and keeps the store immutable', async () => {
    const { core, connection } = await connected()
    connection.subscribeTab('t1').catch(() => undefined)
    await tick()
    const before = connection.store.getSnapshot()
    core.last().core.send({ t: 'reset', stream: 'tab:t1', epoch: 'e2', seq: 4, snapshot: { kind: 'tab', items: [], hasMore: false, requests: [] } })
    core.last().core.send({ t: 'ev', stream: 'tab:t1', epoch: 'e2', seq: 5, ev: { type: 'item.added', item: { kind: 'assistantText', itemId: 'm:0', text: 'he' } } })
    core.last().core.send({ t: 'ev', stream: 'tab:t1', epoch: 'e2', seq: 6, ev: { type: 'item.text', itemId: 'm:0', append: 'llo' } })
    await tick()
    expect(connection.store.getSnapshot().transcripts['t1']?.items).toEqual([{ kind: 'assistantText', itemId: 'm:0', text: 'hello' }])
    expect(connection.store.getSnapshot()).not.toBe(before)
    expect(before.transcripts['t1']).toBeUndefined()
  })

  it('after a drop it reconnects, resumes its streams and re-sends unanswered commands with the same id', async () => {
    const { core, connection } = await connected()
    core.last().core.send({ t: 'ev', stream: 'workspace', epoch: 'e1', seq: 1, ev: { type: 'turn.finished', tabId: 't1' } })
    await tick()
    const pending = connection.request('tab.interrupt', { tabId: 't1' })
    await tick()
    const sentId = (core.last().received[1] as { id: string }).id
    core.last().core.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(core.links).toHaveLength(2)
    expect(core.last().received[0]).toMatchObject({ t: 'hello', resume: { workspace: { epoch: 'e1', lastSeq: 1 } } })
    core.last().core.send(WELCOME)
    await tick()
    expect(core.last().received[1]).toMatchObject({ t: 'cmd', id: sentId, name: 'tab.interrupt' })
    core.last().core.send({ t: 'reply', id: sentId, ok: true, result: {} })
    expect(await pending).toEqual({})
  })

  it('a gap in the numbering forces a reconnect (the core then resets the stream)', async () => {
    const { core } = await connected()
    core.last().core.send({ t: 'ev', stream: 'workspace', epoch: 'e1', seq: 3, ev: { type: 'turn.finished', tabId: 't1' } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(core.links).toHaveLength(2)
  })

  it('after two unanswered pings it drops the channel and reconnects', async () => {
    // Only the ping interval is faked: ticks and the reconnect delay use real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { core, connection } = await connected()
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS)
    expect(core.last().received.at(-1)).toMatchObject({ t: 'ping' })
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2)
    expect(connection.store.getSnapshot().status).not.toBe('connected')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(core.links).toHaveLength(2)
  })

  it('reconnectNow skips the backoff while offline and does nothing while connected', async () => {
    const core = scriptedCore()
    let online = false
    connection = new Connection({ openChannel: () => (online ? core.openChannel() : Promise.reject(new Error('offline'))), clientId: 'c1', retry: { initialMs: 60_000, maxMs: 60_000 } })
    connection.start()
    await tick()
    expect(core.links).toHaveLength(0)
    online = true
    connection.reconnectNow()
    await tick()
    expect(core.links).toHaveLength(1)
    connection.reconnectNow()
    await tick()
    expect(core.links).toHaveLength(1)
  })

  it('stops on incompatible_protocol and tells the store', async () => {
    const core = scriptedCore()
    connection = new Connection({ openChannel: core.openChannel, clientId: 'c1', retry: { initialMs: 1, maxMs: 1 } })
    connection.start()
    await tick()
    core.last().core.send({ t: 'fatal', error: { code: 'incompatible_protocol', message: 'core speaks 2' } })
    core.last().core.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(connection.store.getSnapshot()).toMatchObject({ status: 'incompatible', error: { code: 'incompatible_protocol' } })
    expect(core.links).toHaveLength(1)
  })

  it('a stream that is gone drops the tab view', async () => {
    const { core, connection } = await connected()
    connection.subscribeTab('t1').catch(() => undefined)
    core.last().core.send({ t: 'reset', stream: 'tab:t1', epoch: 'e2', seq: 0, snapshot: { kind: 'tab', items: [], hasMore: false, requests: [] } })
    await tick()
    core.last().core.send({ t: 'gone', stream: 'tab:t1' })
    await tick()
    expect(connection.store.getSnapshot().transcripts['t1']).toBeUndefined()
  })
})

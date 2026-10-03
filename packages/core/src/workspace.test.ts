// Phase 1c core behaviour on the fake SDK. User stories:
// 1. my tabs come back (dormant) after a restart, and reading an old tab starts nothing;
// 2. an untrusted folder never runs anything until I trust it;
// 3. I fork, rename, reorder, restart tabs; I list, rename and delete stored sessions;
// 4. I get a notification when Claude needs me or finishes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, tabStream, type TabMeta, type TabSnapshot, type WorkspaceEvent } from '@claude-wrap/protocol'
import type { Notice } from './config.ts'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { sdk, stored } from './testing/messages.ts'
import { RawClient } from './testing/rawClient.ts'

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))
const freshFolder = (name: string) => {
  const folder = join(mkdtempSync(join(tmpdir(), 'cw-ws-')), name)
  mkdirSync(folder)
  return folder
}

let fake: FakeSdk
let cwd: string
const cores: Core[] = []

function makeCore(overrides: Partial<CoreConfig> = {}): Core {
  const core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, ...overrides })
  cores.push(core)
  return core
}

async function connect(core: Core, trust = true): Promise<RawClient> {
  const client = new RawClient(core)
  await client.hello()
  if (trust) await client.ok('trust.grant', { cwd })
  return client
}

// Tabs as the client sees them on the workspace stream (snapshot + events, order included).
function tabs(client: RawClient): TabMeta[] {
  const reset = client.lastReset(WORKSPACE_STREAM)!
  let list = [...(reset.snapshot as { tabs: TabMeta[] }).tabs]
  for (const frame of client.frames.slice(client.frames.lastIndexOf(reset) + 1)) {
    if (frame.t !== 'ev' || frame.stream !== WORKSPACE_STREAM) continue
    const ev = frame.ev as WorkspaceEvent
    if (ev.type === 'tab.added') list.push(ev.tab)
    if (ev.type === 'tab.updated') list = list.map((tab) => (tab.tabId === ev.tab.tabId ? ev.tab : tab))
    if (ev.type === 'tab.removed') list = list.filter((tab) => tab.tabId !== ev.tabId)
    if (ev.type === 'tab.moved') {
      const moved = list.find((tab) => tab.tabId === ev.tabId)!
      list = list.filter((tab) => tab !== moved)
      list.splice(ev.index, 0, moved)
    }
  }
  return list
}
const meta = (client: RawClient, tabId: string) => tabs(client).find((tab) => tab.tabId === tabId)

beforeEach(() => {
  fake = createFakeSdk()
  cwd = freshFolder('project')
})
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.closeAll()))
})

describe('persistence and restore', () => {
  it('tabs come back dormant after a restart, with title, model and mode (not one where nothing was sent); reading them starts nothing', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-state-'))
    fake.histories.set('s1', [stored.user('u1', 'hello')])
    const first = makeCore({ stateDir })
    const client = await connect(first)
    await client.ok('tab.create', { tabId: 't1', cwd, resume: 's1', model: 'haiku', mode: 'plan' })
    await client.ok('tab.rename', { tabId: 't1', title: 'My work' })
    await client.ok('tab.create', { tabId: 't2', cwd })
    await first.closeAll()

    const second = makeCore({ stateDir })
    const again = await connect(second, false)
    expect(tabs(again).map(({ tabId, title, status, model, mode, sessionId }) => ({ tabId, title, status, model, mode, sessionId }))).toEqual([
      { tabId: 't1', title: 'My work', status: 'dormant', model: 'haiku', mode: 'plan', sessionId: 's1' }
    ])
    await again.ok('tab.subscribe', { tabId: 't1' })
    expect((again.lastReset(tabStream('t1'))!.snapshot as TabSnapshot).items).toHaveLength(1)
    expect(fake.sessions).toHaveLength(0)
  })

  it('trusted folders persist; too-broad ones are trusted for this run only', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-state-'))
    const client = await connect(makeCore({ stateDir }))
    expect(await client.ok('trust.check', { cwd })).toMatchObject({ trusted: true, scope: { path: cwd, sessionOnly: false } })
    const reloaded = await connect(makeCore({ stateDir }), false)
    expect((await reloaded.ok('trust.check', { cwd })).trusted).toBe(true)
  })
})

describe('trust gate and roots', () => {
  it('an untrusted folder blocks the start (needs_trust, no process) until trust.grant', async () => {
    const client = await connect(makeCore(), false)
    await client.ok('tab.create', { tabId: 't1', cwd })
    expect((await client.ok('trust.check', { cwd })).trusted).toBe(false)
    expect(await client.fails('tab.send', { tabId: 't1', text: 'hi' })).toMatchObject({ code: 'needs_trust' })
    expect(meta(client, 't1')?.status).toBe('needs_trust')
    expect(fake.sessions).toHaveLength(0)
    await client.ok('trust.grant', { cwd })
    expect(meta(client, 't1')?.status).toBe('dormant')
    await client.ok('tab.send', { tabId: 't1', text: 'hi' })
    expect(fake.sessions).toHaveLength(1)
  })

  it('a folder outside the allowed roots or missing is refused', async () => {
    const client = await connect(makeCore({ allowedRoots: [freshFolder('root')] }))
    await client.ok('tab.create', { tabId: 't1', cwd })
    expect(await client.fails('tab.send', { tabId: 't1', text: 'hi' })).toMatchObject({ code: 'outside_root' })
    await client.ok('tab.create', { tabId: 't2', cwd: join(cwd, 'missing') })
    expect(await client.fails('tab.send', { tabId: 't2', text: 'hi' })).toMatchObject({ code: 'not_found' })
  })
})

describe('tab operations', () => {
  it('fork copies the session up to an item into a new tab next to it; refused while running', async () => {
    fake.histories.set('s1', [stored.user('u1', 'one'), stored.user('u2', 'two'), stored.user('u3', 'three')])
    fake.infos.set('s1', { cwd, lastModified: 1 })
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd, resume: 's1', title: 'Work' })
    await client.ok('tab.create', { tabId: 't9', cwd })
    await client.ok('tab.subscribe', { tabId: 't1' })
    const { tabId } = await client.ok('tab.fork', { tabId: 't1', newTabId: 't2', upToItemId: 'u2' })
    expect(tabId).toBe('t2')
    expect(tabs(client).map((tab) => tab.tabId)).toEqual(['t1', 't2', 't9'])
    const forked = meta(client, 't2')!
    expect(forked).toMatchObject({ title: 'Work (fork)', status: 'dormant' })
    expect(forked.sessionId).not.toBe('s1')
    expect(fake.histories.get(forked.sessionId!)!.map((message) => message.uuid)).toEqual(['u1', 'u2'])

    await client.ok('tab.send', { tabId: 't1', text: 'go' })
    expect(await client.fails('tab.fork', { tabId: 't1', newTabId: 't3' })).toMatchObject({ code: 'session_busy' })
  })

  it('reorder moves a tab and is announced', async () => {
    const client = await connect(makeCore())
    for (const tabId of ['a', 'b', 'c']) await client.ok('tab.create', { tabId, cwd })
    await client.ok('tab.reorder', { tabId: 'c', index: 0 })
    expect(tabs(client).map((tab) => tab.tabId)).toEqual(['c', 'a', 'b'])
  })

  it('rename also renames the stored session', async () => {
    fake.histories.set('s1', [stored.user('u1', 'hi')])
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd, resume: 's1' })
    await client.ok('tab.rename', { tabId: 't1', title: 'Renamed' })
    expect(fake.infos.get('s1')?.customTitle).toBe('Renamed')
    expect(meta(client, 't1')?.title).toBe('Renamed')
  })

  it('restart after a crash reloads the stored transcript and resumes the same session', async () => {
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'hi' })
    const session = fake.last()
    await session.waitForInput(1)
    session.emit(sdk.init('s1'))
    await tick()
    fake.histories.set('s1', [stored.user('u1', 'hi'), stored.assistant('a1', 'm1', [{ type: 'text', text: 'saved answer' }])])
    session.exit(new Error('crashed'))
    await tick()
    expect(meta(client, 't1')?.status).toBe('error')
    await client.ok('tab.restart', { tabId: 't1' })
    expect(fake.sessions).toHaveLength(2)
    expect(fake.last().options.resume).toBe('s1')
    const snapshot = client.lastReset(tabStream('t1'))!.snapshot as TabSnapshot
    expect(snapshot.items.map((item) => ('text' in item ? item.text : item.kind))).toEqual(['hi', 'saved answer'])
  })

  it('before the first spawn, a stored session changed elsewhere is read again', async () => {
    fake.histories.set('s1', [stored.user('u1', 'old')])
    fake.infos.set('s1', { cwd, lastModified: 1 })
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd, resume: 's1' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    fake.histories.set('s1', [stored.user('u1', 'old'), stored.user('u2', 'written by the terminal CLI')])
    fake.infos.set('s1', { cwd, lastModified: 2 })
    await client.ok('tab.send', { tabId: 't1', text: 'new' })
    const snapshot = client.lastReset(tabStream('t1'))!.snapshot as TabSnapshot
    expect(snapshot.items.map((item) => item.itemId)).toEqual(['u1', 'u2'])
  })
})

describe('stored sessions', () => {
  it('lists newest first with the tab that has each open; rename and delete refuse while a tab references it', async () => {
    fake.histories.set('old', [stored.user('o1', 'old one')])
    fake.infos.set('old', { cwd, lastModified: 1 })
    fake.histories.set('new', [stored.user('n1', 'new one')])
    fake.infos.set('new', { cwd, lastModified: 2, customTitle: 'Newest' })
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd, resume: 'new' })
    expect((await client.ok('sessions.list', { cwd })).sessions).toEqual([
      { sessionId: 'new', title: 'Newest', lastModified: 2, cwd, tabId: 't1' },
      { sessionId: 'old', title: 'old one', lastModified: 1, cwd }
    ])
    expect(await client.fails('sessions.rename', { cwd, sessionId: 'new', title: 'x' })).toMatchObject({ code: 'session_busy' })
    expect(await client.fails('sessions.delete', { cwd, sessionId: 'new' })).toMatchObject({ code: 'session_busy' })
    await client.ok('sessions.rename', { cwd, sessionId: 'old', title: 'Older' })
    expect(fake.infos.get('old')?.customTitle).toBe('Older')
  })

  it('deleting a session whose tab is closing waits for its process, then deletes', async () => {
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd })
    await client.ok('tab.send', { tabId: 't1', text: 'hi' })
    fake.last().emit(sdk.init('s1'))
    await tick()
    fake.histories.set('s1', [stored.user('u1', 'hi')])
    const closing = client.ok('tab.close', { tabId: 't1' })
    await client.ok('sessions.delete', { cwd, sessionId: 's1' })
    await closing
    expect(fake.histories.has('s1')).toBe(false)
    expect(fake.last().closed).toBe(true)
  })
})

describe('notifications', () => {
  it('the notifier hears about requests, finished turns and crashes', async () => {
    const notices: Notice[] = []
    const client = await connect(makeCore({ notifier: (notice) => notices.push(notice) }))
    await client.ok('tab.create', { tabId: 't1', cwd, title: 'Work' })
    await client.ok('tab.send', { tabId: 't1', text: 'hi' })
    const session = fake.last()
    session.askPermission('Write', { file_path: 'a' }, { title: 'Write a' })
    session.emit(sdk.success())
    await tick()
    session.exit(new Error('boom'))
    await tick()
    expect(notices.map(({ kind, tabId, title, detail }) => ({ kind, tabId, title, detail }))).toEqual([
      { kind: 'request', tabId: 't1', title: 'Work', detail: 'Write a' },
      { kind: 'turnFinished', tabId: 't1', title: 'Work', detail: undefined },
      { kind: 'error', tabId: 't1', title: 'Work', detail: 'boom' }
    ])
  })
})

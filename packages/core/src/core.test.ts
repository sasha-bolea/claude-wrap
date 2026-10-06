// Core behaviour through the protocol, on the fake SDK. User stories of Phase 1:
// 1. I open a folder and chat: Claude's answer streams in;
// 2. Claude asks a permission / a question / a plan approval: I answer from any device, first answer wins;
// 3. I interrupt Claude, change mode and model;
// 4. I queue messages while Claude works and can take them back;
// 5. I reopen a past session and read it without starting anything;
// 6. reloads, dropped connections and retries never lose or duplicate anything.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_PALETTE_ID, LIMITS, PRESET_PALETTES, PROTOCOL_VERSION, WORKSPACE_STREAM, createChannelPair, tabStream, type Item, type Palette, type TabMeta, type TabSnapshot, type WorkspaceEvent, type WorkspaceSnapshot } from '@athome/protocol'
import { createCore, type Core, type CoreConfig, type Notice } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'
import { sdk, stored } from './testing/messages.ts'

// A real folder (prepareStart checks it exists), trusted in every core the tests build.
const CWD = join(mkdtempSync(join(tmpdir(), 'cw-core-')), 'demo')
mkdirSync(CWD)
const TAB = tabStream('t1')
// A valid cmd id (UUID) numbered n, for readable expectations.
const cmd = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

let fake: FakeSdk
let core: Core
let client: RawClient

// Builds a core on the fake SDK with fast timers. overrides: extra config for one test.
function makeCore(overrides: Partial<CoreConfig> = {}): Core {
  return createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, ...overrides })
}

// A raw client past hello, with the test folder trusted.
async function connect(to: Core, clientId?: string): Promise<RawClient> {
  const raw = new RawClient(to, clientId)
  await raw.hello()
  await raw.ok('trust.grant', { cwd: CWD })
  return raw
}

// Latest metadata of a tab as seen on the workspace stream.
function meta(of: RawClient, tabId = 't1'): TabMeta | undefined {
  let tab = (of.lastReset(WORKSPACE_STREAM)?.snapshot as { tabs: TabMeta[] } | undefined)?.tabs.find((t) => t.tabId === tabId)
  const reset = of.frames.lastIndexOf(of.lastReset(WORKSPACE_STREAM)!)
  for (const frame of of.frames.slice(reset + 1)) {
    if (frame.t !== 'ev' || frame.stream !== WORKSPACE_STREAM) continue
    const ev = frame.ev as WorkspaceEvent
    if ((ev.type === 'tab.added' || ev.type === 'tab.updated') && ev.tab.tabId === tabId) tab = ev.tab
    if (ev.type === 'tab.removed' && ev.tabId === tabId) tab = undefined
  }
  return tab
}

// Items of a tab as a client sees them: last snapshot + following events.
function items(of: RawClient, stream = TAB): Item[] {
  const reset = of.lastReset(stream)
  const list = structuredClone((reset?.snapshot as TabSnapshot | undefined)?.items ?? [])
  for (const frame of of.frames.slice(reset ? of.frames.lastIndexOf(reset) + 1 : 0)) {
    if (frame.t !== 'ev' || frame.stream !== stream) continue
    const ev = frame.ev
    if (ev.type === 'item.added') list.push(ev.item)
    if (ev.type === 'item.updated') list[list.findIndex((item) => item.itemId === ev.item.itemId)] = ev.item
    if (ev.type === 'item.text') {
      const item = list.find((existing) => existing.itemId === ev.itemId)
      if (item && 'text' in item) item.text += ev.append
    }
  }
  return list
}

// Creates tab t1, subscribes, and sends a first message so a fake process is running.
async function startedTab(args: object = {}) {
  await client.ok('tab.create', { tabId: 't1', cwd: CWD, ...args })
  await client.ok('tab.subscribe', { tabId: 't1' })
  await client.ok('tab.send', { tabId: 't1', text: 'hello' }, cmd(1))
  await fake.last().waitForInput(1)
  return fake.last()
}

// The rename_session control requests a session received (the session's name for the other sessions).
function renames(session: ReturnType<FakeSdk['last']>): object[] {
  return session.calls.filter((call) => call.method === 'request').map((call) => call.args[0] as { subtype?: string }).filter((request) => request.subtype === 'rename_session')
}

// Waits until a condition holds (polled, 2 s at most).
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await tick()
  expect(condition()).toBe(true)
}

beforeEach(async () => {
  fake = createFakeSdk()
  core = makeCore()
  client = await connect(core)
})
afterEach(() => core.closeAll())

describe('tabs and lazy start', () => {
  it('creating and viewing a tab starts no process', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    expect(client.lastReset(TAB)?.snapshot).toEqual({ kind: 'tab', items: [], hasMore: false, requests: [] })
    expect(meta(client)).toMatchObject({ tabId: 't1', cwd: CWD, title: 'demo', status: 'dormant', mode: 'default', queue: [], pendingRequests: 0 })
    expect(fake.sessions).toHaveLength(0)
  })

  it('viewing a past session loads its stored history without starting a process', async () => {
    fake.histories.set('s1', [stored.user('u1', 'hi'), stored.assistant('a1', 'm1', [{ type: 'text', text: 'hello!' }])])
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    expect(items(client).map((item) => item.kind)).toEqual(['user', 'assistantText'])
    expect(meta(client)?.sessionId).toBe('s1')
    expect(fake.sessions).toHaveLength(0)
  })

  it('sending starts the CLI with the session options and appends the user item', async () => {
    const session = await startedTab({ model: 'haiku', mode: 'plan' })
    expect(session.options).toMatchObject({
      cwd: CWD,
      model: 'haiku',
      permissionMode: 'plan',
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' }
    })
    expect(session.received[0]).toMatchObject({ type: 'user', uuid: cmd(1), message: { role: 'user', content: 'hello' }, origin: { kind: 'human' } })
    expect(items(client)).toEqual([{ kind: 'user', itemId: cmd(1), sourceUuid: cmd(1), text: 'hello', from: 'client-a' }])
    expect(meta(client)?.status).toBe('running')
  })

  it('concurrent starts spawn a single process', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await Promise.all([client.ok('tab.send', { tabId: 't1', text: 'a' }), client.ok('tab.commands', { tabId: 't1' }), client.ok('tab.models', { tabId: 't1' })])
    expect(fake.sessions).toHaveLength(1)
  })

  it('a duplicate tabId, or a session another tab owns, returns the existing tab', async () => {
    expect(await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })).toEqual({ tabId: 't1' })
    expect(await client.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's1' })).toEqual({ tabId: 't1' })
    expect(await client.ok('tab.create', { tabId: 't1', cwd: 'C:/elsewhere' })).toEqual({ tabId: 't1' })
    expect((client.lastReset(WORKSPACE_STREAM)!.snapshot as { tabs: TabMeta[] }).tabs).toHaveLength(0)
    expect(client.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'tab.added')).toHaveLength(1)
  })

  it('a tab where nothing was ever sent does not come back after a restart; one with a session does', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-unused-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    await client.ok('tab.create', { tabId: 'empty', cwd: CWD })
    await client.ok('tab.create', { tabId: 'used', cwd: CWD, resume: 's1' })
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect((client.lastReset(WORKSPACE_STREAM)!.snapshot as { tabs: TabMeta[] }).tabs.map((tab) => tab.tabId)).toEqual(['used'])
  })

  // The session's name (what other sessions see) is the tab's title, like the Claude app: the title the CLI generates
  // after the first prompt, or the name the user gives, which then stays.
  it("the tab and its session take the CLI's generated title after the first prompt; a name the user gives stays, on the tab and on the live session", async () => {
    const session = await startedTab()
    expect(session.options.env?.CLAUDE_CODE_SESSION_NAME).toBe('demo')
    session.emit(sdk.init('s-titled'))
    fake.histories.set('s-titled', [stored.user('u1', 'Please fix the login page of the app')])
    fake.infos.set('s-titled', { lastModified: 1, aiTitle: 'Fix login page' })
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.title === 'Fix login page')
    await until(() => renames(session).length === 1)
    expect(renames(session)).toEqual([{ subtype: 'rename_session', title: 'Fix login page', source: 'remote' }])
    await client.ok('tab.rename', { tabId: 't1', title: 'Login review' })
    expect(renames(session).at(-1)).toEqual({ subtype: 'rename_session', title: 'Login review', source: 'host' })
    // The CLI's title changes afterwards: the tab keeps its name.
    fake.infos.set('s-titled', { lastModified: 2, aiTitle: 'Something else' })
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, cmd(2))
    await session.waitForInput(2)
    session.emit(sdk.success())
    await tick()
    await tick()
    expect(meta(client)?.title).toBe('Login review')
    expect(renames(session)).toHaveLength(2)
  })

  it("without a generated title the tab takes the first 3 words of the first prompt; a stored session opened from the list takes the CLI's title", async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-long'))
    fake.histories.set('s-long', [stored.user('u1', 'Please   refactor the whole settings screen, '.repeat(4))])
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.title === 'Please refactor the')
    await until(() => renames(session).length === 1)
    expect(renames(session)[0]).toMatchObject({ title: 'Please refactor the' })
    fake.histories.set('s-stored', [stored.user('u2', 'Stored one')])
    fake.infos.set('s-stored', { lastModified: 1, aiTitle: 'Stored title' })
    await client.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's-stored' })
    await client.waitFor(() => meta(client, 't2')?.title === 'Stored title')
  })

  it('a session that refuses the rename keeps working: the automatic name stays quiet, a rename by the user reports it', async () => {
    const session = await startedTab()
    session.refusedRequests.add('rename_session')
    session.emit(sdk.init('s-refused'))
    fake.histories.set('s-refused', [stored.user('u1', 'Tidy the docs folder')])
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.title === 'Tidy the docs')
    await until(() => renames(session).length === 1)
    await tick()
    expect(items(client).filter((item) => item.kind === 'notice')).toEqual([])
    expect(meta(client)?.status).toBe('idle')
    expect(await client.fails('tab.rename', { tabId: 't1', title: 'Docs cleanup' })).toMatchObject({ code: 'sdk_error' })
    expect(meta(client)?.title).toBe('Docs cleanup')
  })

  it('a tab created with a name starts its session with that name and keeps it', async () => {
    const session = await startedTab({ title: 'Release notes' })
    expect(session.options.env?.CLAUDE_CODE_SESSION_NAME).toBe('Release notes')
    session.emit(sdk.init('s-named'))
    fake.histories.set('s-named', [stored.user('u1', 'Plan the work')])
    fake.infos.set('s-named', { lastModified: 1, aiTitle: 'Work plan' })
    session.emit(sdk.success())
    await tick()
    await tick()
    expect(meta(client)?.title).toBe('Release notes')
    expect(renames(session)).toEqual([])
  })

  // A message another session sends (SendMessage) starts a turn here by itself: the chat shows who sent it and what,
  // before the answer, live and when the session is opened again.
  it('a message from another session shows in the chat with its sender, before the answer, live and in the history', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-peer'))
    session.emit(sdk.success())
    fake.histories.set('s-peer', [stored.user('u1', 'hello'), stored.peer('p1', 'other-session', 'Tests pass on main')])
    session.emit(sdk.lifecycle('p1', 'started'))
    await client.waitFor(() => items(client).some((item) => item.kind === 'peerMessage'))
    session.emit(sdk.assistant('msg-reply', [{ type: 'text', text: 'Thanks, merging' }]), sdk.success(), sdk.lifecycle('p1', 'completed'))
    await client.waitFor(() => items(client).some((item) => item.kind === 'assistantText'))
    const after = items(client).filter((item) => item.kind === 'peerMessage' || item.kind === 'assistantText')
    expect(after).toMatchObject([{ kind: 'peerMessage', itemId: 'p1', from: 'other-session', text: 'Tests pass on main' }, { kind: 'assistantText', text: 'Thanks, merging' }])

    fake.histories.set('s-peer-old', [stored.user('u2', 'start'), stored.peer('p2', 'docs-session', 'Run the tests')])
    await client.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's-peer-old' })
    await client.ok('tab.subscribe', { tabId: 't2' })
    const stored2 = items(client, tabStream('t2'))
    expect(stored2.filter((item) => item.kind === 'peerMessage')).toMatchObject([{ itemId: 'p2', from: 'docs-session', text: 'Run the tests' }])
    expect(stored2.some((item) => item.kind === 'user' && item.text.includes('cross-session-message'))).toBe(false)
  })

  // The CLI writes its session file in batches: the message may be readable only a moment after its turn started.
  it('a message from another session stored a moment late still shows before the answer to it', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-peer-slow'))
    session.emit(sdk.success())
    fake.histories.set('s-peer-slow', [stored.user('u1', 'hello')])
    session.emit(sdk.lifecycle('p4', 'started'))
    session.emit(sdk.messageStart('msg-slow'), sdk.blockStart(0, { type: 'text', text: '' }), sdk.textDelta(0, 'On it'))
    setTimeout(() => fake.histories.set('s-peer-slow', [stored.user('u1', 'hello'), stored.peer('p4', 'other-session', 'Late but first')]), 200)
    await client.waitFor(() => items(client).some((item) => item.kind === 'assistantText'), 3000)
    session.emit(sdk.assistant('msg-slow', [{ type: 'text', text: 'On it' }]), sdk.success())
    await client.waitFor(() => items(client).filter((item) => item.kind === 'turnEnd').length === 2)
    expect(items(client).slice(-3).map((item) => item.kind)).toEqual(['peerMessage', 'assistantText', 'turnEnd'])
  })

  it('a turn from another session that the history does not have takes its sender from the end of the turn, still before the answer', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-peer-late'))
    session.emit(sdk.success())
    session.emit(sdk.lifecycle('p3', 'started'))
    session.emit(sdk.assistant('msg-late', [{ type: 'text', text: 'On it' }]))
    session.emit(sdk.success({ origin: { kind: 'peer', from: 'uds:/x.sock', name: 'build-session', body: 'Deploy is green' } }))
    await client.waitFor(() => items(client).filter((item) => item.kind === 'turnEnd').length === 2, 3000)
    expect(items(client).filter((item) => item.kind === 'peerMessage')).toMatchObject([{ itemId: 'p3', from: 'build-session', text: 'Deploy is green' }])
    expect(items(client).slice(-3).map((item) => item.kind)).toEqual(['peerMessage', 'assistantText', 'turnEnd'])
  })

  it('a malformed message from another session, or one without text, breaks nothing and shows no empty bubble', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-peer-bad'))
    session.emit(sdk.success())
    fake.histories.set('s-peer-bad', [stored.user('u1', 'hello'), { type: 'user', uuid: 'p5', parent_tool_use_id: null, origin: { kind: 'peer', name: 'x' } } as never])
    session.emit(sdk.lifecycle('p5', 'started'))
    session.emit(sdk.assistant('msg-bad', [{ type: 'text', text: 'Still here' }]), sdk.success({ origin: { kind: 'peer', from: 'uds:/y.sock' } }))
    await client.waitFor(() => items(client).filter((item) => item.kind === 'turnEnd').length === 2, 3000)
    expect(items(client).some((item) => item.kind === 'peerMessage')).toBe(false)
    expect(meta(client)?.status).toBe('idle')
    fake.histories.set('s-peer-bad-old', [stored.user('u2', 'start'), stored.peer('p6', '', '')])
    await client.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's-peer-bad-old' })
    await client.ok('tab.subscribe', { tabId: 't2' })
    expect(items(client, tabStream('t2')).map((item) => item.kind)).toEqual(['user'])
  })

  it('init sets the session id and the active model', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-new', { model: 'claude-haiku-4-5' }))
    await tick()
    expect(meta(client)).toMatchObject({ sessionId: 's-new', activeModel: 'claude-haiku-4-5' })
  })
})

describe('streaming', () => {
  it('coalesces deltas into item.text events and the final frame updates the same item', async () => {
    const session = await startedTab()
    session.emit(sdk.messageStart('m1'), sdk.blockStart(0, { type: 'text', text: '' }), sdk.textDelta(0, 'a'), sdk.textDelta(0, 'b'), sdk.textDelta(0, 'c'))
    await tick()
    session.emit(sdk.assistant('m1', [{ type: 'text', text: 'abc' }]))
    await tick()
    const events = client.events(TAB)
    expect(events.filter((ev) => ev.type === 'item.added' && ev.item.itemId === 'm1:0')).toEqual([{ type: 'item.added', item: { kind: 'assistantText', itemId: 'm1:0', text: 'a' } }])
    expect(events.filter((ev) => ev.type === 'item.text')).toEqual([{ type: 'item.text', itemId: 'm1:0', append: 'bc' }])
    expect(events.at(-1)).toMatchObject({ type: 'item.updated', item: { itemId: 'm1:0', text: 'abc' } })
  })

  it('a client subscribing mid-stream gets the flushed text in its snapshot, then only new deltas', async () => {
    const session = await startedTab()
    session.emit(sdk.messageStart('m1'), sdk.blockStart(0, { type: 'text', text: '' }), sdk.textDelta(0, 'a'))
    await tick()
    // 'b' is still waiting in the coalescer when the second client subscribes.
    session.emit(sdk.textDelta(0, 'b'))
    await tick(0)
    const late = new RawClient(core, 'client-b')
    await late.hello()
    await late.ok('tab.subscribe', { tabId: 't1' })
    session.emit(sdk.textDelta(0, 'c'))
    await tick()
    expect(items(late).at(-1)).toMatchObject({ itemId: 'm1:0', text: 'abc' })
    expect(items(client).at(-1)).toMatchObject({ itemId: 'm1:0', text: 'abc' })
  })

  it('a result ends the turn: turnEnd item, idle status, turn.finished', async () => {
    const session = await startedTab()
    session.emit(sdk.success({ total_cost_usd: 0.5 }))
    await tick()
    expect(items(client).at(-1)).toMatchObject({ kind: 'turnEnd', costUsd: 0.5 })
    expect(meta(client)?.status).toBe('idle')
    expect(client.events(WORKSPACE_STREAM)).toContainEqual({ type: 'turn.finished', tabId: 't1' })
  })

  it('tab.history pages older items than the snapshot', async () => {
    core = makeCore({ snapshotItems: 2 })
    client = await connect(core)
    fake.histories.set('s1', ['u1', 'u2', 'u3', 'u4'].map((id) => stored.user(id, `text ${id}`)))
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    const snapshot = client.lastReset(TAB)!.snapshot as TabSnapshot
    expect(snapshot.items.map((item) => item.itemId)).toEqual(['u3', 'u4'])
    expect(snapshot.hasMore).toBe(true)
    const older = await client.ok('tab.history', { tabId: 't1', beforeItemId: 'u3', limit: 5 })
    expect(older).toEqual({ items: [expect.objectContaining({ itemId: 'u1' }), expect.objectContaining({ itemId: 'u2' })], hasMore: false })
  })

  it('conversation_reset moves the session id and starts an empty transcript with a new epoch', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s1'))
    await tick()
    const oldEpoch = client.lastReset(TAB)!.epoch
    session.emit(sdk.conversationReset('s2'))
    await tick()
    expect(meta(client)?.sessionId).toBe('s2')
    expect(client.lastReset(TAB)).toMatchObject({ snapshot: { items: [] } })
    expect(client.lastReset(TAB)!.epoch).not.toBe(oldEpoch)
  })
})

// Sub-phase B: as in the terminal, a message sent while Claude works goes to the CLI at once and is read at its next
// step (verified on CLI 2.1.287: priority 'next', command_lifecycle queued → started → completed).
describe('messages sent while Claude works', () => {
  it('go to the CLI at once with priority next and stay pending until the CLI reads them', async () => {
    const session = await startedTab()
    expect(items(client)[0]).not.toHaveProperty('pending')
    session.emit(sdk.lifecycle(cmd(1), 'queued'), sdk.lifecycle(cmd(1), 'started'))
    expect(await client.ok('tab.send', { tabId: 't1', text: 'also this' }, cmd(2))).toEqual({})
    await session.waitForInput(2)
    expect(session.received[1]).toMatchObject({ uuid: cmd(2), priority: 'next' })
    await tick()
    const second = () => items(client).find((item) => item.itemId === cmd(2))
    expect(second()).toMatchObject({ kind: 'user', text: 'also this', pending: true })
    session.emit(sdk.lifecycle(cmd(2), 'queued'))
    await tick()
    expect(second()).toMatchObject({ pending: true })
    session.emit(sdk.lifecycle(cmd(2), 'started'))
    await tick()
    expect(second()).not.toHaveProperty('pending')
    session.emit(sdk.lifecycle(cmd(2), 'completed'), sdk.success(), sdk.lifecycle(cmd(1), 'completed'))
    await tick()
    expect(meta(client)?.status).toBe('idle')
  })

  it('one the CLI has not read when the turn ends keeps the tab working until its own turn ends', async () => {
    const notices: Notice[] = []
    core = makeCore({ notifier: (notice) => notices.push(notice) })
    client = await connect(core)
    const session = await startedTab()
    session.emit(sdk.lifecycle(cmd(1), 'queued'), sdk.lifecycle(cmd(1), 'started'))
    await client.ok('tab.send', { tabId: 't1', text: 'later' }, cmd(2))
    session.emit(sdk.lifecycle(cmd(2), 'queued'), sdk.success(), sdk.lifecycle(cmd(1), 'completed'))
    await tick()
    expect(meta(client)?.status).toBe('running')
    expect(notices).toEqual([])
    expect(client.events(WORKSPACE_STREAM)).not.toContainEqual({ type: 'turn.finished', tabId: 't1' })
    session.emit(sdk.lifecycle(cmd(2), 'started'), sdk.success(), sdk.lifecycle(cmd(2), 'completed'))
    await tick()
    expect(meta(client)?.status).toBe('idle')
    expect(notices.map((notice) => notice.kind)).toEqual(['turnFinished'])
  })

  it("Send now on a waiting message asks the CLI to read it now (its own send-now), without pausing the queue", async () => {
    const session = await startedTab()
    session.emit(sdk.lifecycle(cmd(1), 'queued'), sdk.lifecycle(cmd(1), 'started'))
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'queued later' })
    await client.ok('tab.send', { tabId: 't1', text: 'now please' }, cmd(2))
    session.emit(sdk.lifecycle(cmd(2), 'queued'))
    await tick()
    expect(await client.ok('tab.sendPendingNow', { tabId: 't1', itemId: cmd(2) })).toEqual({})
    expect(session.calls.at(-1)).toEqual({ method: 'request', args: [{ subtype: 'interrupt', send_now: true, message_uuid: cmd(2) }] })
    expect(meta(client)?.queuePause).toBeUndefined()
    // Only a message still waiting: the first one was read already.
    expect(await client.fails('tab.sendPendingNow', { tabId: 't1', itemId: cmd(1) })).toMatchObject({ code: 'invalid_args' })
  })

  it('a send already in the transcript (retry after a core restart) is not dispatched again', async () => {
    fake.histories.set('s1', [stored.user(cmd(9), 'hi')])
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    expect(await client.ok('tab.send', { tabId: 't1', text: 'hi' }, cmd(9))).toEqual({})
    expect(fake.sessions.flatMap((session) => session.received)).toHaveLength(0)
  })
})

// Sub-phase B: the tab's own queue (queue mode of the composer), one message at a time when Claude is free.
describe('queue', () => {
  it('goes one message at a time when Claude is free; added while Claude is free, the first goes at once', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'first' }, cmd(2))
    await client.waitFor(() => fake.sessions.length === 1)
    const session = fake.last()
    await session.waitForInput(1)
    expect(session.received[0]).toMatchObject({ uuid: cmd(2) })
    expect(session.received[0]).not.toHaveProperty('priority')
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'second' }, cmd(3))
    await tick()
    expect(meta(client)?.queue).toEqual([{ queueId: cmd(3), text: 'second', from: 'client-a' }])
    expect(session.received).toHaveLength(1)
    session.emit(sdk.success())
    await session.waitForInput(2)
    expect(session.received[1]).toMatchObject({ uuid: cmd(3) })
    await tick()
    expect(meta(client)).toMatchObject({ queue: [], status: 'running' })
  })

  it('queued messages can be edited, moved and removed', async () => {
    await startedTab()
    for (const [n, text] of [[2, 'a'], [3, 'b'], [4, 'c']] as const) await client.ok('tab.queueAdd', { tabId: 't1', text }, cmd(n))
    await client.ok('tab.queueEdit', { tabId: 't1', queueId: cmd(3), text: 'B' })
    await client.ok('tab.queueMove', { tabId: 't1', queueId: cmd(4), index: 0 })
    await client.ok('tab.unqueue', { tabId: 't1', queueId: cmd(2) })
    await tick()
    expect(meta(client)?.queue.map((message) => message.text)).toEqual(['c', 'B'])
    expect(await client.fails('tab.queueEdit', { tabId: 't1', queueId: cmd(2), text: 'x' })).toMatchObject({ code: 'not_found' })
  })

  it('"send now" takes a message out of the queue and sends it at once, without interrupting', async () => {
    const session = await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'urgent' }, cmd(2))
    await client.ok('tab.sendNow', { tabId: 't1', queueId: cmd(2) })
    await session.waitForInput(2)
    expect(session.received[1]).toMatchObject({ uuid: cmd(2), priority: 'next' })
    expect(session.count('interrupt')).toBe(0)
    await tick()
    expect(meta(client)?.queue).toEqual([])
  })

  it('waits after Stop and when paused by hand; ▶ resumes it', async () => {
    const session = await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'next' }, cmd(2))
    await client.ok('tab.interrupt', { tabId: 't1' })
    expect(session.count('interrupt')).toBe(1)
    session.emit(sdk.aborted())
    await tick()
    expect(meta(client)?.queuePause).toEqual({ reason: 'stop' })
    expect(session.received).toHaveLength(1)
    await client.ok('tab.queuePause', { tabId: 't1', paused: false })
    await session.waitForInput(2)
    expect(session.received[1]).toMatchObject({ uuid: cmd(2) })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'after' }, cmd(3))
    await client.ok('tab.queuePause', { tabId: 't1', paused: true })
    await tick()
    expect(meta(client)?.queuePause).toEqual({ reason: 'user' })
    session.emit(sdk.success())
    await tick()
    expect(session.received).toHaveLength(2)
  })

  it('a usage limit pauses the queue of every tab until it resets; the session it stopped waits for "Continua", the others go on', async () => {
    const session = await startedTab()
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'after the limit' }, cmd(2))
    const resetsAt = Math.ceil(Date.now() / 1000) + 1
    session.emit(sdk.rateLimit('rejected', resetsAt), sdk.success())
    await tick()
    expect(meta(client)).toMatchObject({ queuePause: { reason: 'limit', until: resetsAt * 1000 }, interrupted: 'limit', limitedUntil: resetsAt * 1000 })
    expect(meta(client, 't2')).toMatchObject({ queuePause: { reason: 'limit', until: resetsAt * 1000 } })
    expect(meta(client, 't2')?.interrupted).toBeUndefined()
    await client.waitFor(() => meta(client)?.limitedUntil === undefined, 3000)
    await client.waitFor(() => meta(client, 't2')?.queuePause === undefined)
    expect(meta(client)).toMatchObject({ interrupted: 'limit', queuePause: { reason: 'limit' } })
    expect(session.received).toHaveLength(1)
    await client.ok('tabs.continue', { text: 'continua' })
    await session.waitForInput(2)
    expect(JSON.stringify(session.received[1]!.message.content)).toContain('continua')
    session.emit(sdk.success())
    await session.waitForInput(3)
    expect(JSON.stringify(session.received[2]!.message.content)).toContain('after the limit')
    expect(meta(client)?.interrupted).toBeUndefined()
  })

  it('while a client shows the chat, the next queued message waits a countdown there; stopping it gives it back and pauses the rest', async () => {
    core = makeCore({ queueCountdownMs: 80 })
    client = await connect(core)
    const session = await startedTab()
    await client.ok('client.watch', { tabId: 't1' })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'first' }, cmd(2))
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'second' }, cmd(3))
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.queueCountdown?.queueId === cmd(2))
    expect(meta(client)!.queueCountdown!.until).toBeGreaterThan(Date.now())
    expect(session.received).toHaveLength(1)
    await session.waitForInput(2)
    expect(session.received[1]).toMatchObject({ uuid: cmd(2) })
    await client.waitFor(() => meta(client)?.queueCountdown === undefined)
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.queueCountdown?.queueId === cmd(3))
    expect(await client.ok('tab.queueHold', { tabId: 't1', queueId: cmd(3) })).toEqual({ text: 'second' })
    await client.waitFor(() => meta(client)?.queueCountdown === undefined)
    expect(meta(client)?.queue).toEqual([])
    await tick(150)
    expect(session.received).toHaveLength(2)
    expect(await client.fails('tab.queueHold', { tabId: 't1', queueId: cmd(3) })).toMatchObject({ code: 'request_resolved' })
  })

  it('nobody watching (or the chat left, or the page hidden): the queue goes at once', async () => {
    core = makeCore({ queueCountdownMs: 5000 })
    client = await connect(core)
    const session = await startedTab()
    await client.ok('client.watch', { tabId: 't1' })
    await client.ok('client.visibility', { visible: false })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'next' }, cmd(2))
    session.emit(sdk.success())
    await session.waitForInput(2)
    expect(meta(client)?.queueCountdown).toBeUndefined()
  })

  it('an empty queue is never paused, except by a usage limit', async () => {
    const session = await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'later' }, cmd(2))
    await client.ok('tab.interrupt', { tabId: 't1' })
    await client.waitFor(() => meta(client)?.queuePause?.reason === 'stop')
    await client.ok('tab.unqueue', { tabId: 't1', queueId: cmd(2) })
    await client.waitFor(() => meta(client)?.queuePause === undefined)
    await client.ok('tab.queuePause', { tabId: 't1', paused: true })
    await tick()
    expect(meta(client)?.queuePause).toBeUndefined()
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600), sdk.success())
    await client.waitFor(() => meta(client)?.queuePause?.reason === 'limit')
    expect(meta(client)?.queue).toEqual([])
  })

  it('survives a core restart, waiting for ▶; closing the tab discards it', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-queue-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'kept' }, cmd(2))
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(meta(client)).toMatchObject({ queue: [{ queueId: cmd(2), text: 'kept' }], queuePause: { reason: 'stop' } })
    await client.ok('tab.queuePause', { tabId: 't1', paused: false })
    await client.waitFor(() => fake.sessions.length === 2)
    await fake.last().waitForInput(1)
    expect(fake.last().received[0]).toMatchObject({ uuid: cmd(2) })
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'dropped' }, cmd(3))
    await client.ok('tab.close', { tabId: 't1' })
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(meta(client)).toBeUndefined()
  })
})

describe('requests', () => {
  const RULES: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'localSettings' }]

  it('a permission request is broadcast, answered semantically, and resolved for everyone', async () => {
    const session = await startedTab()
    const { requestId, result } = session.askPermission('Write', { file_path: 'a.txt' }, { suggestions: [...RULES], title: 'Write a.txt' })
    await client.waitFor(() => client.events(TAB).some((ev) => ev.type === 'request.opened'))
    expect(client.events(TAB).at(-1)).toMatchObject({ type: 'request.opened', request: { requestId, kind: 'permission', toolName: 'Write', canAllowAlways: true, title: 'Write a.txt' } })
    expect(meta(client)).toMatchObject({ status: 'requires_action', pendingRequests: 1 })
    await client.ok('request.answer', { tabId: 't1', requestId, decision: 'allow' })
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.txt' } })
    await tick()
    expect(client.events(TAB).at(-1)).toEqual({ type: 'request.resolved', requestId, by: 'client-a', outcome: 'allow' })
    expect(meta(client)).toMatchObject({ status: 'running', pendingRequests: 0 })
  })

  it('the work time of a turn is kept by core and stops while Claude waits for an answer', async () => {
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const session = await startedTab()
      session.emit(sdk.init('s-clock'))
      await until(() => meta(client)?.workingSince !== undefined)
      const start = meta(client)!.workingSince!
      now += 5_000
      const { requestId } = session.askPermission('Write', { file_path: 'a.txt' })
      await until(() => meta(client)?.status === 'requires_action')
      expect(meta(client)?.workingSince).toBeUndefined()
      now += 60_000
      await client.ok('request.answer', { tabId: 't1', requestId, decision: 'allow' })
      await until(() => meta(client)?.status === 'running')
      // Resumed: 5 s worked before the request, the minute of waiting does not count.
      expect(meta(client)?.workingSince).toBe(start + 60_000)
      // Another client (a reopened app) reads the same start.
      const other = await connect(core, 'client-b')
      expect(meta(other)?.workingSince).toBe(start + 60_000)
      session.emit(sdk.success())
      await until(() => meta(client)?.status === 'idle')
      expect(meta(client)?.workingSince).toBeUndefined()
    } finally {
      clock.mockRestore()
    }
  })

  it('"always" passes the CLI suggestions; deny carries the reason or a default', async () => {
    const session = await startedTab()
    const always = session.askPermission('Write', { file_path: 'a' }, { suggestions: [...RULES] })
    const denied = session.askPermission('Write', { file_path: 'b' })
    const silent = session.askPermission('Write', { file_path: 'c' })
    await tick()
    await client.ok('request.answer', { tabId: 't1', requestId: always.requestId, decision: 'allowAlways' })
    await client.ok('request.answer', { tabId: 't1', requestId: denied.requestId, decision: 'deny', reason: 'use b.txt' })
    await client.ok('request.answer', { tabId: 't1', requestId: silent.requestId, decision: 'deny' })
    expect(await always.result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a' }, updatedPermissions: [...RULES] })
    expect(await denied.result).toEqual({ behavior: 'deny', message: 'use b.txt' })
    expect(await silent.result).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/.+/) })
  })

  it('a question is answered with the chosen labels; a plan approval can switch mode', async () => {
    const session = await startedTab({ mode: 'plan' })
    const question = session.askPermission('AskUserQuestion', { questions: [{ question: 'Which?' }] })
    const plan = session.askPermission('ExitPlanMode', { plan: '1. do it' })
    await tick()
    expect(client.events(TAB).filter((ev) => ev.type === 'request.opened').map((ev) => ev.type === 'request.opened' && ev.request.kind)).toEqual(['question', 'plan'])
    await client.ok('request.answer', { tabId: 't1', requestId: question.requestId, decision: 'allow', answers: { 'Which?': 'A, B' } })
    await client.ok('request.answer', { tabId: 't1', requestId: plan.requestId, decision: 'allow', planNextMode: 'acceptEdits' })
    expect(await question.result).toEqual({ behavior: 'allow', updatedInput: { questions: [{ question: 'Which?' }], answers: { 'Which?': 'A, B' } } })
    expect(await plan.result).toEqual({
      behavior: 'allow',
      updatedInput: { plan: '1. do it' },
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    })
    expect(meta(client)?.mode).toBe('acceptEdits')
  })

  it('the first answer wins across clients; later answers get request_resolved', async () => {
    const session = await startedTab()
    const other = new RawClient(core, 'client-b')
    await other.hello()
    await other.ok('tab.subscribe', { tabId: 't1' })
    const { requestId, result } = session.askPermission('Write', { file_path: 'a' })
    await tick()
    expect((other.lastReset(TAB)!.snapshot as TabSnapshot).requests.length + other.events(TAB).filter((ev) => ev.type === 'request.opened').length).toBe(1)
    await other.ok('request.answer', { tabId: 't1', requestId, decision: 'deny', reason: 'no' })
    expect(await client.fails('request.answer', { tabId: 't1', requestId, decision: 'allow' })).toMatchObject({ code: 'request_resolved' })
    expect(await result).toMatchObject({ behavior: 'deny' })
    await tick()
    expect(client.events(TAB)).toContainEqual({ type: 'request.resolved', requestId, by: 'client-b', outcome: 'deny' })
  })

  it('a request cancelled by the CLI disappears everywhere', async () => {
    const session = await startedTab()
    const { requestId, abort } = session.askPermission('Write', { file_path: 'a' })
    await tick()
    abort()
    await tick()
    expect(client.events(TAB).at(-1)).toEqual({ type: 'request.cancelled', requestId })
    expect(meta(client)).toMatchObject({ pendingRequests: 0, status: 'running' })
  })
})

describe('controls', () => {
  it('interrupt reaches the CLI', async () => {
    const session = await startedTab()
    await client.ok('tab.interrupt', { tabId: 't1' })
    expect(session.count('interrupt')).toBe(1)
  })

  it('mode and model on a dormant tab only update it and are passed at spawn', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.setMode', { tabId: 't1', mode: 'acceptEdits' })
    await client.ok('tab.setModel', { tabId: 't1', model: 'haiku' })
    expect(fake.sessions).toHaveLength(0)
    expect(meta(client)).toMatchObject({ mode: 'acceptEdits', model: 'haiku' })
    await client.ok('tab.send', { tabId: 't1', text: 'go' })
    expect(fake.last().options).toMatchObject({ permissionMode: 'acceptEdits', model: 'haiku' })
  })

  it('a rejected mode change falls back to the confirmed mode with a notice', async () => {
    const session = await startedTab()
    session.rejectNext = new Error('bypass not allowed')
    expect(await client.fails('tab.setMode', { tabId: 't1', mode: 'bypassPermissions' })).toMatchObject({ code: 'sdk_error' })
    await tick()
    expect(meta(client)?.mode).toBe('default')
    expect(items(client).at(-1)).toMatchObject({ kind: 'notice', level: 'error' })
  })

  it('mode changes made by the CLI are adopted, but an in-flight change wins over a stale status', async () => {
    const session = await startedTab()
    session.emit(sdk.status('plan'))
    await tick()
    expect(meta(client)?.mode).toBe('plan')
    let release!: () => void
    session.gate = new Promise((resolve) => (release = resolve))
    const change = client.ok('tab.setMode', { tabId: 't1', mode: 'acceptEdits' })
    await tick()
    session.emit(sdk.status('plan'))
    await tick()
    expect(meta(client)?.mode).toBe('acceptEdits')
    release()
    await change
    expect(meta(client)?.mode).toBe('acceptEdits')
  })

  it('a live model change reaches the CLI', async () => {
    const session = await startedTab()
    await client.ok('tab.setModel', { tabId: 't1', model: 'haiku' })
    expect(session.calls.at(-1)).toEqual({ method: 'setModel', args: ['haiku'] })
    expect(meta(client)?.model).toBe('haiku')
  })

  it('context and usage come from the CLI, reduced for the panels; an API-key session has no plan limits', async () => {
    const session = await startedTab()
    const context = await client.ok('tab.context', { tabId: 't1' })
    expect(context).toMatchObject({ model: 'fake-model', totalTokens: 48500, maxTokens: 200000, percentage: 24, autoCompact: true, autoCompactThreshold: 155000 })
    expect(context.categories.find((row) => row.kind === 'free')).toEqual({ name: 'Free space', tokens: 106500, kind: 'free' })
    expect(context.mcpServers).toEqual([{ name: 'docs', tools: 2, tokens: 2600 }])
    const usage = await client.ok('tab.usage', { tabId: 't1' })
    expect(session.calls.at(-1)).toEqual({ method: 'usage', args: [{ skipBehaviors: true }] })
    expect(usage.session).toMatchObject({ costUsd: 0.42, linesAdded: 12, models: [{ model: 'fake-model', inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 52000, cacheWriteTokens: 8000, costUsd: 0.42 }] })
    expect(usage.limits).toEqual({
      fiveHour: { utilization: 37, resetsAt: '2099-10-03T22:00:00.000Z' },
      sevenDay: { utilization: 12, resetsAt: '2099-10-08T09:00:00.000Z' },
      models: [{ name: 'Fable', utilization: 5, resetsAt: '2099-10-08T09:00:00.000Z' }]
    })
    session.usage = { ...session.usage!, subscription_type: null, rate_limits_available: false, rate_limits: null }
    expect((await client.ok('tab.usage', { tabId: 't1' })).limits).toBeNull()
    session.usage = undefined
    expect(await client.fails('tab.usage', { tabId: 't1' })).toMatchObject({ code: 'sdk_error' })
  })

  it('after each turn the tab shows its context share and its account plan windows; the plan is read at most once a minute', async () => {
    const session = await startedTab()
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.planLimits !== undefined)
    expect(meta(client)).toMatchObject({
      context: { percentage: 24, totalTokens: 48500, maxTokens: 200000 },
      planLimits: { fiveHour: { utilization: 37, resetsAt: '2099-10-03T22:00:00.000Z' }, sevenDay: { utilization: 12 } }
    })
    expect(meta(client, 't2')?.planLimits?.fiveHour?.utilization).toBe(37)
    expect(meta(client, 't2')?.context).toBeUndefined()
    expect(session.calls.find((call) => call.method === 'getContextUsage')?.args).toEqual([{ detail: 'summary' }])
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, cmd(2))
    await session.waitForInput(2)
    session.emit(sdk.success())
    await client.waitFor(() => session.calls.filter((call) => call.method === 'getContextUsage').length === 2)
    await tick()
    expect(session.calls.filter((call) => call.method === 'usage')).toHaveLength(1)
    await client.ok('tab.refreshGauges', { tabId: 't1' })
    expect(session.calls.filter((call) => call.method === 'usage')).toHaveLength(2)
  })

  it('refreshing the gauges of a dormant tab starts no process; its last context share and the plan windows come back after a restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-gauges-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    const session = await startedTab()
    session.emit(sdk.init('s-gauge'), sdk.success())
    await client.waitFor(() => meta(client)?.context !== undefined && meta(client)?.planLimits !== undefined)
    await tick(50)
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    const sessions = fake.sessions.length
    await client.ok('tab.refreshGauges', { tabId: 't1' })
    expect(fake.sessions).toHaveLength(sessions)
    expect(meta(client)).toMatchObject({ context: { percentage: 24 }, planLimits: { fiveHour: { utilization: 37 }, sevenDay: { utilization: 12 } } })
  })

  it('a token account (no /usage limits) gets its plan windows from the rate_limit_events of its turns', async () => {
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('accounts.setDefault', { accountId })
    const session = await startedTab()
    session.usage = { ...session.usage!, subscription_type: null, rate_limits_available: false, rate_limits: null }
    const event = sdk.rateLimit('allowed_warning', 1791070800) as { rate_limit_info: object }
    event.rate_limit_info = { ...event.rate_limit_info, utilization: 0.95, unifiedWindows: { five_hour: { utilization: 0.95, resetsAt: 1791070800 }, seven_day: { utilization: 0.4, resetsAt: 1791576000 } } }
    session.emit(event as never, sdk.success())
    await client.waitFor(() => session.calls.some((call) => call.method === 'usage'))
    await tick()
    expect(meta(client)?.planLimits).toEqual({
      fiveHour: { utilization: 95, resetsAt: new Date(1791070800 * 1000).toISOString() },
      sevenDay: { utilization: 40, resetsAt: new Date(1791576000 * 1000).toISOString() }
    })
  })

  it("a dormant tab's gauge sheet reads the plan windows through a live session of the same account", async () => {
    const session = await startedTab()
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    session.emit(sdk.success())
    await client.waitFor(() => session.calls.some((call) => call.method === 'usage'))
    await client.ok('tab.refreshGauges', { tabId: 't2' })
    expect(session.calls.filter((call) => call.method === 'usage')).toHaveLength(2)
    expect(fake.sessions).toHaveLength(1)
  })

  it("the auto-compact window set in the app reaches every process at spawn: a live one restarts at the end of its turn; unset, Claude Code's own applies", async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-compact'))
    await client.ok('settings.setAutoCompactWindow', { tokens: 150_000 })
    expect((client.events(WORKSPACE_STREAM) as { type: string; autoCompactWindow?: number }[]).find((ev) => ev.type === 'settings.updated')?.autoCompactWindow).toBe(150_000)
    await tick()
    expect(session.closed).toBe(false)
    session.emit(sdk.success())
    await client.waitFor(() => session.closed)
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, cmd(2))
    await client.waitFor(() => fake.sessions.length === 2)
    expect(fake.last().options).toMatchObject({ resume: 's-compact', settings: { autoCompactWindow: 150_000 } })
    expect(await client.fails('settings.setAutoCompactWindow', { tokens: 50_000 })).toMatchObject({ code: 'invalid_args' })
    fake.last().emit(sdk.success())
    await client.waitFor(() => meta(client)?.status === 'idle')
    await client.ok('settings.setAutoCompactWindow', {})
    await client.waitFor(() => fake.last().closed)
    await client.ok('tab.send', { tabId: 't1', text: 'once more' }, cmd(3))
    await client.waitFor(() => fake.sessions.length === 3)
    expect(fake.last().options.settings).toBeUndefined()
  })

  it('a dormant tab starts its process to tell its context, without sending anything', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    expect((await client.ok('tab.context', { tabId: 't1' })).totalTokens).toBe(48500)
    expect(fake.last().received).toHaveLength(0)
  })

  it('commands hide internal ones; models come from the CLI', async () => {
    await startedTab()
    expect((await client.ok('tab.commands', { tabId: 't1' })).commands.map((command) => command.name)).toEqual(['compact'])
    expect((await client.ok('tab.models', { tabId: 't1' })).models.map((model) => model.value)).toEqual(['default', 'haiku'])
  })
})

describe('close and process lifecycle', () => {
  it('closing denies pending requests, interrupts before closing, discards the queue and removes the tab', async () => {
    const session = await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'queued' })
    const { result } = session.askPermission('Write', { file_path: 'a' })
    await tick()
    await client.ok('tab.close', { tabId: 't1' })
    expect(await result).toMatchObject({ behavior: 'deny', interrupt: true })
    const order = session.calls.map((call) => call.method).filter((method) => method === 'interrupt' || method === 'close')
    expect(order).toEqual(['interrupt', 'close'])
    expect(session.received).toHaveLength(1)
    expect(client.events(WORKSPACE_STREAM).at(-1)).toEqual({ type: 'tab.removed', tabId: 't1' })
  })

  it('closing during start waits for the start and leaves no process behind', async () => {
    let releaseHistory!: () => void
    const held = new Promise<void>((resolve) => (releaseHistory = resolve))
    core = makeCore({ sdk: { ...fake, getSessionMessages: async () => (await held, []) } })
    client = await connect(core)
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    const sending = client.cmd('tab.send', { tabId: 't1', text: 'hi' })
    await tick()
    expect(meta(client)?.status).toBe('starting')
    const closing = client.ok('tab.close', { tabId: 't1' })
    await tick()
    expect(meta(client)?.status).toBe('closing')
    releaseHistory()
    await closing
    await sending
    expect(fake.sessions.every((session) => session.closed)).toBe(true)
  })

  it('a process that dies on its own puts the tab in error and keeps the transcript', async () => {
    const session = await startedTab()
    session.askPermission('Write', { file_path: 'a' })
    await tick()
    session.exit(new Error('claude exited with code 1'))
    await tick()
    expect(meta(client)).toMatchObject({ status: 'error', pendingRequests: 0, error: expect.stringContaining('code 1') })
    expect(items(client).map((item) => item.kind)).toEqual(['user', 'notice'])
  })

  it('a retried command id executes once and gets the same reply', async () => {
    await startedTab()
    const first = await client.cmd('tab.queueAdd', { tabId: 't1', text: 'again' }, cmd(7))
    const second = await client.cmd('tab.queueAdd', { tabId: 't1', text: 'again' }, cmd(7))
    expect(second).toEqual(first)
    expect(meta(client)?.queue).toHaveLength(1)
  })

  it('rejects invalid args, unknown tabs and oversize messages', async () => {
    expect(await client.fails('tab.create', { tabId: '' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('tab.send', { tabId: 'nope', text: 'x' })).toMatchObject({ code: 'not_found' })
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    expect(await client.fails('tab.send', { tabId: 't1', text: 'x'.repeat(31 * 1024 * 1024) })).toMatchObject({ code: 'too_large' })
  })
})

// Phase 2 user stories: I attach images and long pastes; I send a queued message now; I run a `!` command and
// Claude sees its output; I mention files with `@`; I recall what I sent before (here and in the terminal CLI).
describe('composer (Phase 2)', () => {
  const PNG = { mediaType: 'image/png' as const, data: Buffer.from('fake png').toString('base64') }

  it('images go to the CLI as content blocks; the item references them and blob.get returns the bytes', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'what is this?', images: [PNG] }, cmd(1))
    const session = fake.last()
    await session.waitForInput(1)
    expect(session.received[0]!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.data } },
      { type: 'text', text: 'what is this?' }
    ])
    const item = items(client)[0]
    expect(item).toMatchObject({ kind: 'user', text: 'what is this?', images: [{ mediaType: 'image/png' }] })
    const imageId = item?.kind === 'user' ? item.images![0]!.imageId : ''
    expect(await client.ok('blob.get', { tabId: 't1', imageId })).toEqual(PNG)
  })

  it('an image-only message is accepted; an empty one and an oversize image are refused', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    expect(await client.fails('tab.send', { tabId: 't1', text: '  ' })).toMatchObject({ code: 'invalid_args' })
    const big = { mediaType: 'image/png', data: 'A'.repeat(7 * 1024 * 1024) }
    expect(await client.fails('tab.send', { tabId: 't1', text: '', images: [big] })).toMatchObject({ code: 'too_large' })
    expect(await client.ok('tab.send', { tabId: 't1', text: '', images: [PNG] })).toEqual({})
  })

  it('a queued image message shows its image count and carries the images when it goes', async () => {
    const session = await startedTab()
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'and this', images: [PNG, PNG] }, cmd(2))
    await tick()
    expect(meta(client)?.queue).toEqual([{ queueId: cmd(2), text: 'and this', images: 2, from: 'client-a' }])
    session.emit(sdk.success())
    await session.waitForInput(2)
    expect(session.received[1]!.message.content).toHaveLength(3)
  })

  it('stored image blocks of a resumed session come back as image references', async () => {
    const content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } }, { type: 'text', text: 'look' }]
    fake.histories.set('s1', [stored.user('u1', content)])
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    const item = items(client)[0]
    expect(item).toMatchObject({ kind: 'user', text: 'look', images: [{ mediaType: 'image/jpeg' }] })
    const imageId = item?.kind === 'user' ? item.images![0]!.imageId : ''
    expect(await client.ok('blob.get', { tabId: 't1', imageId })).toEqual({ mediaType: 'image/jpeg', data: 'abc' })
  })

  it('long pastes are passed as inline_pastes', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.send', { tabId: 't1', text: 'fix this:\nLOG', pastes: ['LOG'] })
    await fake.last().waitForInput(1)
    expect(fake.last().received[0]).toMatchObject({ message: { content: 'fix this:\nLOG' }, inline_pastes: ['LOG'] })
  })

  it('a shell command runs in the folder, becomes a shell item and is appended for Claude without a turn', async () => {
    const session = await startedTab()
    session.emit(sdk.success())
    await tick()
    const turnsBefore = client.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'turn.finished').length
    expect(await client.ok('tab.shell', { tabId: 't1', command: 'echo hi' })).toEqual({ exitCode: 0 })
    // The CLI answers each transcript-only message with an empty result: no turn end, no "finished" notification.
    session.emit(sdk.success({ num_turns: 0 }), sdk.success({ num_turns: 0 }))
    await tick()
    expect(items(client).at(-1)).toMatchObject({ kind: 'shell', command: 'echo hi', output: expect.stringContaining('hi'), exitCode: 0 })
    expect(client.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'turn.finished')).toHaveLength(turnsBefore)
    expect(session.received.slice(1)).toMatchObject([
      { shouldQuery: false, message: { content: '<bash-input>echo hi</bash-input>' } },
      { shouldQuery: false, message: { content: expect.stringMatching(/^<bash-stdout>hi\s*<\/bash-stdout><bash-stderr><\/bash-stderr>$/) } }
    ])
    expect(meta(client)?.status).toBe('idle')
    expect(await client.ok('tab.shell', { tabId: 't1', command: 'exit 3' })).toEqual({ exitCode: 3 })
  })

  it('a shell command is refused while a turn runs', async () => {
    await startedTab()
    expect(await client.fails('tab.shell', { tabId: 't1', command: 'echo hi' })).toMatchObject({ code: 'session_busy' })
  })

  it('stored shell commands of a resumed session come back as shell items', async () => {
    fake.histories.set('s1', [stored.user('u1', '<bash-input>ls</bash-input>'), stored.user('u2', '<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>')])
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    expect(items(client)).toEqual([{ kind: 'shell', itemId: 'u1', sourceUuid: 'u1', command: 'ls', output: 'a.txt' }])
  })

  it('file suggestions rank basename matches first and skip dependency folders', async () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'cw-files-')), 'proj')
    for (const file of ['src/main.ts', 'docs/domain.md', 'README.md', 'node_modules/pkg/main.js']) {
      mkdirSync(join(folder, file, '..'), { recursive: true })
      writeFileSync(join(folder, file), '')
    }
    await client.ok('trust.grant', { cwd: folder })
    await client.ok('tab.create', { tabId: 't1', cwd: folder })
    const { paths } = await client.ok('tab.suggestFiles', { tabId: 't1', query: 'main' })
    expect(paths[0]).toBe('src/main.ts')
    expect(paths).toContain('docs/domain.md')
    expect(paths.some((path) => path.includes('node_modules'))).toBe(false)
    expect((await client.ok('tab.suggestFiles', { tabId: 't1', query: 'src' })).paths[0]).toBe('src/')
    expect(fake.sessions).toHaveLength(0)
  })

  it('file suggestions need a trusted folder', async () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'cw-files-')), 'untrusted')
    mkdirSync(folder)
    await client.ok('tab.create', { tabId: 't1', cwd: folder })
    expect(await client.fails('tab.suggestFiles', { tabId: 't1', query: '' })).toMatchObject({ code: 'needs_trust' })
  })

  it('prompt history merges the app and terminal CLI prompts of the folder, newest first, without duplicates', async () => {
    const claudeDir = mkdtempSync(join(tmpdir(), 'cw-claude-'))
    const line = (display: string, timestamp: number, project = CWD, pastedContents = {}) => JSON.stringify({ display, pastedContents, timestamp, project })
    const lines = [
      line('old', 1000),
      line('elsewhere', 1500, 'C:/other'),
      line('hello', 1800),
      line('see [Pasted text #1 +2 lines]', 2000, CWD, { 1: { id: 1, type: 'text', content: 'a\nb\nc' } })
    ]
    writeFileSync(join(claudeDir, 'history.jsonl'), lines.join('\n') + '\n')
    core = makeCore({ claudeConfigDir: claudeDir })
    client = await connect(core)
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.send', { tabId: 't1', text: 'hello' })
    const { prompts } = await client.ok('prompts.history', { cwd: CWD })
    expect(prompts.map((prompt) => prompt.text)).toEqual(['hello', 'see a\nb\nc', 'old'])
  })
})

// Phase 3 user stories (core side): from the phone I browse and create folders, never outside the server's root;
// other devices see my device name on what I send; device commands exist only on the server.
describe('remote backend support (Phase 3)', () => {
  const ROOT = mkdtempSync(join(tmpdir(), 'cw-root-'))
  mkdirSync(join(ROOT, 'alpha'))
  mkdirSync(join(ROOT, 'beta'))
  mkdirSync(join(ROOT, '.hidden'))

  const entry = (name: string, project = false) => ({ name, path: join(ROOT, name), project })

  it('folders.list lists the root by default, hides dot folders, and stops at the root', async () => {
    core = makeCore({ allowedRoots: [ROOT] })
    client = await connect(core)
    expect(await client.ok('folders.list', {})).toEqual({ path: ROOT, folders: [entry('alpha'), entry('beta')], files: { count: 0, hidden: 0 } })
    expect(await client.ok('folders.list', { path: join(ROOT, 'alpha') })).toEqual({ path: join(ROOT, 'alpha'), parent: ROOT, folders: [], files: { count: 0, hidden: 0 } })
    expect(await client.fails('folders.list', { path: join(ROOT, '..') })).toMatchObject({ code: 'outside_root' })
    expect(await client.fails('folders.list', { path: join(ROOT, 'missing') })).toMatchObject({ code: 'not_found' })
  })

  it('folders.create creates a folder inside the roots only, with a safe name', async () => {
    core = makeCore({ allowedRoots: [ROOT] })
    client = await connect(core)
    expect(await client.ok('folders.create', { path: ROOT, name: 'gamma' })).toEqual({ path: join(ROOT, 'gamma') })
    expect(await client.fails('folders.create', { path: ROOT, name: 'gamma' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('folders.create', { path: ROOT, name: '../escape' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('folders.create', { path: tmpdir(), name: 'nope' })).toMatchObject({ code: 'outside_root' })
  })

  it('device commands answer not_found unless the host provides them', async () => {
    expect(await client.fails('devices.list', {})).toMatchObject({ code: 'not_found' })
    core = makeCore({
      hostCommands: { 'devices.list': (_args, connection) => ({ devices: [{ deviceId: connection.deviceId ?? '-', name: connection.label, createdAt: 1, current: true }] }) }
    })
    const host = new RawClient(core, 'client-x')
    await host.hello()
    expect((await host.ok('devices.list', {})).devices[0]).toMatchObject({ deviceId: '-', name: 'client-x' })
  })

  it('a connection attached with an identity shows its device name on what it sends', async () => {
    await startedTab()
    const [clientEnd, coreEnd] = createChannelPair()
    core.attach(coreEnd, { deviceId: 'd1', label: 'phone' })
    clientEnd.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'pwa', visible: true, resume: {} })
    clientEnd.send({ t: 'cmd', id: cmd(5), name: 'tab.send', args: { tabId: 't1', text: 'from the phone' } })
    await tick()
    expect(items(client).at(-1)).toMatchObject({ kind: 'user', text: 'from the phone', from: 'phone' })
  })
})

// Phase 3b: a push goes only to devices that are not looking: every notice carries the devices with a client on screen.
describe('notices and client visibility (Phase 3b)', () => {
  it('notices list the paired devices with a visible client; client.visibility updates it', async () => {
    const notices: Notice[] = []
    core = makeCore({ notifier: (notice) => notices.push(notice) })
    client = await connect(core)
    const attach = (deviceId: string, visible: boolean) => {
      const [clientEnd, coreEnd] = createChannelPair()
      core.attach(coreEnd, { deviceId, label: deviceId })
      clientEnd.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: deviceId, visible, resume: {} })
      return clientEnd
    }
    const phone = attach('phone', true)
    attach('tablet', false)
    const session = await startedTab()
    session.emit(sdk.success())
    await tick()
    expect(notices.at(-1)).toMatchObject({ kind: 'turnFinished', visibleDevices: ['phone'] })
    phone.send({ t: 'cmd', id: cmd(8), name: 'client.visibility', args: { visible: false } })
    await tick()
    await client.ok('tab.send', { tabId: 't1', text: 'again' })
    session.emit(sdk.success())
    await tick()
    expect(notices.at(-1)).toMatchObject({ kind: 'turnFinished', visibleDevices: [] })
  })

  it('every notice counts the chats waiting for an answer and the ones finished but not looked at yet', async () => {
    const notices: Notice[] = []
    core = makeCore({ notifier: (notice) => notices.push(notice) })
    client = await connect(core)
    const counts = () => notices.map(({ kind, tabId, waiting, finished }) => ({ kind, tabId, waiting, finished }))
    const first = await startedTab()
    first.emit(sdk.success())
    await tick()
    // A second chat asks for permission, then an error stops a third one.
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    await client.ok('tab.send', { tabId: 't2', text: 'two' })
    await fake.last().waitForInput(1)
    fake.last().askPermission('Write', { file_path: 'a' }, { title: 'Write a' })
    await tick()
    await client.ok('tab.create', { tabId: 't3', cwd: CWD })
    await client.ok('tab.send', { tabId: 't3', text: 'three' })
    await fake.last().waitForInput(1)
    fake.last().exit(new Error('boom'))
    await tick()
    expect(counts()).toEqual([
      { kind: 'turnFinished', tabId: 't1', waiting: 0, finished: 1 },
      { kind: 'request', tabId: 't2', waiting: 1, finished: 1 },
      { kind: 'error', tabId: 't3', waiting: 1, finished: 2 }
    ])
    // Looking at a finished chat takes it off; a chat working again too.
    await client.ok('client.watch', { tabId: 't1' })
    await client.ok('client.watch', {})
    await client.ok('tab.send', { tabId: 't3', text: 'again' })
    await fake.last().waitForInput(1)
    await client.ok('tab.create', { tabId: 't4', cwd: CWD })
    await client.ok('tab.send', { tabId: 't4', text: 'four' })
    await fake.last().waitForInput(1)
    fake.last().emit(sdk.success())
    await tick()
    expect(counts().at(-1)).toEqual({ kind: 'turnFinished', tabId: 't4', waiting: 1, finished: 1 })
    // A chat finished while on screen is not counted.
    await client.ok('client.watch', { tabId: 't4' })
    await client.ok('tab.send', { tabId: 't4', text: 'more' })
    await fake.last().waitForInput(2)
    fake.last().emit(sdk.success())
    await tick()
    expect(counts().at(-1)).toEqual({ kind: 'turnFinished', tabId: 't4', waiting: 1, finished: 0 })
  })

  it('a chat finished while nobody looked is unseen until someone looks at it, also after a restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-unseen-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    const session = await startedTab()
    session.emit(sdk.init('s-unseen'))
    session.emit(sdk.success())
    await tick()
    expect(meta(client)?.unseen).toBe(true)
    await client.ok('client.watch', { tabId: 't1' })
    await tick()
    expect(meta(client)?.unseen).toBeUndefined()
    // Finished while on screen: not unseen. Finished away from it: unseen again, and it survives a restart.
    await client.ok('tab.send', { tabId: 't1', text: 'again' })
    await session.waitForInput(2)
    session.emit(sdk.success())
    await tick()
    expect(meta(client)?.unseen).toBeUndefined()
    await client.ok('client.watch', {})
    await client.ok('tab.send', { tabId: 't1', text: 'more' })
    await session.waitForInput(3)
    session.emit(sdk.success())
    await tick()
    expect(meta(client)?.unseen).toBe(true)
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(meta(client)?.unseen).toBe(true)
  })
})

// Sub-phase A: the server updates itself only while no session is working; core keeps their number in a file.
describe('activity file (server auto-update)', () => {
  it('counts the sessions at work: running or waiting for an answer, back to 0 at the end of the turn', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cw-activity-')), 'activity.json')
    const working = () => {
      try {
        return (JSON.parse(readFileSync(file, 'utf8')) as { working: number }).working
      } catch {
        return undefined
      }
    }
    core = makeCore({ activityFile: file })
    client = await connect(core)
    await expect.poll(working).toBe(0)
    const session = await startedTab()
    await expect.poll(working).toBe(1)
    const { requestId } = session.askPermission('Write', { file_path: 'a.txt' })
    await client.waitFor(() => meta(client)?.status === 'requires_action')
    expect(working()).toBe(1)
    await client.ok('request.answer', { tabId: 't1', requestId, decision: 'allow' })
    session.emit(sdk.success())
    await expect.poll(working).toBe(0)
  })
})

// Last folders.updated seen by a client (or the snapshot's home and projects).
function folders(of: RawClient): { home: unknown; projects: string[] } | undefined {
  const event = of.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'folders.updated').at(-1)
  const latest = event?.type === 'folders.updated' ? event : (of.lastReset(WORKSPACE_STREAM)?.snapshot as WorkspaceSnapshot | undefined)
  return latest && { home: latest.home, projects: latest.projects }
}

// Sub-phase B: the Home is made of folders (the server's root, or the folders added on this PC), projects are marked
// in core for every device, and sessions are listed per folder or for every folder.
describe('folders, projects and sessions', () => {
  const tempDir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))

  it('project marks: on any folder, saved, announced to every client, and back after a restart', async () => {
    const root = tempDir('cw-projects-')
    mkdirSync(join(root, 'alpha'))
    const stateDir = tempDir('cw-projects-state-')
    core = makeCore({ allowedRoots: [root], stateDir })
    client = await connect(core)
    const other = await connect(core, 'client-b')
    expect(folders(other)).toEqual({ home: { kind: 'root', path: root }, projects: [] })
    await client.ok('folders.setProject', { path: join(root, 'alpha'), project: true })
    await client.ok('folders.create', { path: join(root, 'alpha'), name: 'sub', project: true })
    await other.waitFor(() => folders(other)?.projects.length === 2)
    expect((await client.ok('folders.list', {})).folders).toEqual([{ name: 'alpha', path: join(root, 'alpha'), project: true }])
    expect((await client.ok('folders.list', { path: join(root, 'alpha') })).folders).toEqual([{ name: 'sub', path: join(root, 'alpha', 'sub'), project: true }])
    await client.ok('folders.setProject', { path: join(root, 'alpha', 'sub'), project: false })
    await core.closeAll()
    core = makeCore({ allowedRoots: [root], stateDir })
    client = await connect(core)
    expect(folders(client)).toEqual({ home: { kind: 'root', path: root }, projects: [join(root, 'alpha')] })
    expect(await client.fails('folders.setProject', { path: tmpdir(), project: true })).toMatchObject({ code: 'outside_root' })
  })

  it('a folder counts the files right inside it, and how many of them are hidden (.git apart)', async () => {
    const root = tempDir('cw-count-')
    mkdirSync(join(root, 'sub'))
    mkdirSync(join(root, '.git'))
    for (const name of ['a.ts', 'b.md', '.env', '.gitignore', join('sub', 'deep.ts')]) writeFileSync(join(root, name), 'x')
    core = makeCore({ allowedRoots: [root] })
    client = await connect(core)
    expect((await client.ok('folders.list', {})).files).toEqual({ count: 4, hidden: 2 })
    expect((await client.ok('folders.list', { path: join(root, 'sub') })).files).toEqual({ count: 1, hidden: 0 })
  })

  it('this PC: the Home lists the added folders, at first the ones of the open sessions; taking one off keeps its files', async () => {
    const stateDir = tempDir('cw-added-state-')
    // A state from before the Home: open tabs, no list of added folders yet.
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ version: 1, trustedFolders: [], tabs: [{ tabId: 't1', title: 'demo', cwd: CWD, mode: 'default' }], livePids: [] }))
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(folders(client)?.home).toEqual({ kind: 'added', folders: [CWD] })
    const extra = tempDir('cw-added-')
    expect(await client.ok('folders.add', { path: extra })).toEqual({ path: extra })
    await client.ok('folders.remove', { path: CWD })
    await client.waitFor(() => JSON.stringify(folders(client)?.home) === JSON.stringify({ kind: 'added', folders: [extra] }))
    expect(existsSync(CWD)).toBe(true)
    expect(await client.fails('folders.add', { path: join(extra, 'missing') })).toMatchObject({ code: 'not_found' })
    const server = makeCore({ allowedRoots: [extra] })
    const remote = await connect(server)
    expect(await remote.fails('folders.add', { path: extra })).toMatchObject({ code: 'invalid_args' })
    await server.closeAll()
  })

  it('the sessions of every folder: newest first, with their folder, only those inside the roots', async () => {
    const root = tempDir('cw-sessions-')
    core = makeCore({ allowedRoots: [root] })
    client = await connect(core)
    const save = (sessionId: string, cwd: string, lastModified: number) => {
      fake.histories.set(sessionId, [stored.user(cmd(lastModified), sessionId)])
      fake.infos.set(sessionId, { cwd, lastModified })
    }
    save('old', join(root, 'alpha'), 1)
    save('new', join(root, 'beta'), 2)
    save('elsewhere', tmpdir(), 3)
    const { sessions } = await client.ok('sessions.list', {})
    expect(sessions.map((session) => [session.sessionId, session.cwd])).toEqual([['new', join(root, 'beta')], ['old', join(root, 'alpha')]])
  })

  it('deleting a folder: never the Home itself, refused with a session open inside; to the app trash with its project marks, back with them', async () => {
    const root = tempDir('cw-delete-')
    mkdirSync(join(root, 'proj', 'inner'), { recursive: true })
    writeFileSync(join(root, 'proj', 'a.txt'), 'x')
    core = makeCore({ allowedRoots: [root], stateDir: tempDir('cw-delete-state-') })
    client = await connect(core)
    await client.ok('folders.setProject', { path: join(root, 'proj'), project: true })
    await client.ok('folders.setProject', { path: join(root, 'proj', 'inner'), project: true })
    await client.ok('tab.create', { tabId: 't1', cwd: join(root, 'proj', 'inner') })
    expect(await client.fails('folders.delete', { path: join(root, 'proj') })).toMatchObject({ code: 'session_busy' })
    await client.ok('tab.close', { tabId: 't1' })
    expect(await client.fails('folders.delete', { path: root })).toMatchObject({ code: 'invalid_args' })
    await client.ok('folders.delete', { path: join(root, 'proj') })
    expect(existsSync(join(root, 'proj'))).toBe(false)
    await client.waitFor(() => folders(client)?.projects.length === 0)
    const { items: trashed } = await client.ok('trash.list', {})
    expect(trashed).toMatchObject([{ path: join(root, 'proj'), kind: 'folder' }])
    expect(await client.ok('trash.restore', { id: trashed[0]!.id })).toEqual({ path: join(root, 'proj') })
    expect(readFileSync(join(root, 'proj', 'a.txt'), 'utf8')).toBe('x')
    await client.waitFor(() => folders(client)?.projects.length === 2)
  })

  it('deleting a folder with its sessions: the sessions open inside it are closed first, the others stay', async () => {
    const root = tempDir('cw-delete-open-')
    mkdirSync(join(root, 'proj', 'inner'), { recursive: true })
    mkdirSync(join(root, 'other'))
    core = makeCore({ allowedRoots: [root], stateDir: tempDir('cw-delete-open-state-') })
    client = await connect(core)
    await client.ok('tab.create', { tabId: 't1', cwd: join(root, 'proj') })
    await client.ok('tab.create', { tabId: 't2', cwd: join(root, 'proj', 'inner') })
    await client.ok('tab.create', { tabId: 't3', cwd: join(root, 'other') })
    await client.ok('folders.delete', { path: join(root, 'proj'), closeSessions: true })
    expect(existsSync(join(root, 'proj'))).toBe(false)
    const removed = client.events(WORKSPACE_STREAM).flatMap((ev) => (ev.type === 'tab.removed' ? [ev.tabId] : []))
    expect(removed.sort()).toEqual(['t1', 't2'])
  })

  it('on the desktop a folder is deleted to the system trash; an added folder is only taken off the Home', async () => {
    const trashed: string[] = []
    const added = tempDir('cw-system-trash-')
    mkdirSync(join(added, 'old'))
    core = makeCore({ stateDir: tempDir('cw-system-trash-state-'), trashItem: async (path) => void trashed.push(path) })
    client = await connect(core)
    await client.ok('folders.add', { path: added })
    expect(await client.fails('folders.delete', { path: added })).toMatchObject({ code: 'invalid_args' })
    await client.ok('folders.delete', { path: join(added, 'old') })
    expect(trashed).toEqual([join(added, 'old')])
    expect((await client.ok('trash.list', {})).items).toEqual([])
  })
})

// Sub-phase B: the file explorer of a session's folder, and the app's trash (7 days) on the remote server.
describe('files and trash', () => {
  const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100', 'hex')

  // A trusted session folder with a fake .git, a readme and a src folder, open in tab "f".
  async function filesTab(config: Partial<CoreConfig> = {}): Promise<string> {
    const folder = mkdtempSync(join(tmpdir(), 'cw-files-'))
    mkdirSync(join(folder, 'src'))
    mkdirSync(join(folder, '.git'))
    writeFileSync(join(folder, '.git', 'config'), '[core]')
    writeFileSync(join(folder, 'readme.md'), '# hi')
    writeFileSync(join(folder, 'src', 'a.ts'), 'export {}')
    core = makeCore({ stateDir: mkdtempSync(join(tmpdir(), 'cw-files-state-')), ...config })
    client = await connect(core)
    await client.ok('trust.grant', { cwd: folder })
    await client.ok('tab.create', { tabId: 'f', cwd: folder })
    return folder
  }

  it('lists folders first and hides .git; refuses paths outside the folder or into .git', async () => {
    const folder = await filesTab()
    const { entries } = await client.ok('files.list', { tabId: 'f', path: '' })
    expect(entries.map((file) => [file.name, file.kind])).toEqual([['src', 'folder'], ['readme.md', 'file']])
    expect(entries[1]).toMatchObject({ size: 4 })
    expect((await client.ok('files.list', { tabId: 'f', path: 'src' })).entries.map((file) => file.name)).toEqual(['a.ts'])
    for (const path of ['..', '../x', 'src/../..', join(folder, 'readme.md')]) {
      expect(await client.fails('files.list', { tabId: 'f', path })).toMatchObject({ code: 'outside_root' })
    }
    expect(await client.fails('files.read', { tabId: 'f', path: '.git/config' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('files.delete', { tabId: 'f', path: '.git' })).toMatchObject({ code: 'invalid_args' })
  })

  it.skipIf(process.platform === 'win32')('refuses a symlink that leads outside the folder, also to write through it', async () => {
    const folder = await filesTab()
    const outside = mkdtempSync(join(tmpdir(), 'cw-outside-'))
    symlinkSync(outside, join(folder, 'out'))
    symlinkSync(join(outside, 'victim.txt'), join(folder, 'broken'))
    expect(await client.fails('files.list', { tabId: 'f', path: 'out' })).toMatchObject({ code: 'outside_root' })
    const data = Buffer.from('x').toString('base64')
    expect(await client.fails('files.write', { tabId: 'f', path: 'out/x.txt', data })).toMatchObject({ code: 'outside_root' })
    expect(await client.fails('files.write', { tabId: 'f', path: 'broken', data, overwrite: true })).toMatchObject({ code: 'not_found' })
    expect(existsSync(join(outside, 'victim.txt'))).toBe(false)
    // Deleting a link deletes the link, not what it points to.
    symlinkSync(join(folder, 'src'), join(folder, 'shortcut'))
    await client.ok('files.delete', { tabId: 'f', path: 'shortcut' })
    expect(existsSync(join(folder, 'src', 'a.ts'))).toBe(true)
    expect((await client.ok('trash.list', {})).items).toMatchObject([{ path: join(folder, 'shortcut') }])
  })

  it('previews text and images, truncated past the limit; a download gets the whole file', async () => {
    const folder = await filesTab()
    expect(await client.ok('files.read', { tabId: 'f', path: 'readme.md' })).toEqual({ mediaType: 'text/markdown', encoding: 'utf8', data: '# hi', size: 4, truncated: false })
    writeFileSync(join(folder, 'pic.png'), PNG_BYTES)
    expect(await client.ok('files.read', { tabId: 'f', path: 'pic.png' })).toEqual({ mediaType: 'image/png', encoding: 'base64', data: PNG_BYTES.toString('base64'), size: PNG_BYTES.length, truncated: false })
    writeFileSync(join(folder, 'big.log'), 'x'.repeat(LIMITS.previewBytes + 10))
    const preview = await client.ok('files.read', { tabId: 'f', path: 'big.log' })
    expect(preview).toMatchObject({ encoding: 'utf8', size: LIMITS.previewBytes + 10, truncated: true })
    expect(preview.data).toHaveLength(LIMITS.previewBytes)
    const download = await client.ok('files.read', { tabId: 'f', path: 'big.log', download: true })
    expect(download).toMatchObject({ encoding: 'base64', truncated: false })
    expect(Buffer.from(download.data, 'base64')).toHaveLength(LIMITS.previewBytes + 10)
  })

  it('uploads, creates folders, renames and moves; never overwrites unless asked', async () => {
    const folder = await filesTab()
    const base64 = (text: string) => Buffer.from(text).toString('base64')
    expect(await client.ok('files.write', { tabId: 'f', path: 'src/new.txt', data: base64('hello') })).toEqual({ path: 'src/new.txt' })
    expect(await client.fails('files.write', { tabId: 'f', path: 'src/new.txt', data: base64('again') })).toMatchObject({ code: 'invalid_args' })
    await client.ok('files.write', { tabId: 'f', path: 'src/new.txt', data: base64('bye'), overwrite: true })
    expect(readFileSync(join(folder, 'src', 'new.txt'), 'utf8')).toBe('bye')
    await client.ok('files.mkdir', { tabId: 'f', path: 'docs' })
    await client.ok('files.rename', { tabId: 'f', from: 'src/new.txt', to: 'docs/moved.txt' })
    expect(readFileSync(join(folder, 'docs', 'moved.txt'), 'utf8')).toBe('bye')
    expect(await client.fails('files.rename', { tabId: 'f', from: 'readme.md', to: 'docs/moved.txt' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('files.write', { tabId: 'f', path: 'nowhere/x.txt', data: base64('x') })).toMatchObject({ code: 'not_found' })
  })

  it('deleted files go to the trash; restore puts them back unless the place is taken; delete forever and empty', async () => {
    const folder = await filesTab()
    await client.ok('files.delete', { tabId: 'f', path: 'readme.md' })
    await tick(5)
    await client.ok('files.delete', { tabId: 'f', path: 'src' })
    expect(existsSync(join(folder, 'readme.md'))).toBe(false)
    const { items: trashed } = await client.ok('trash.list', { under: folder })
    expect(trashed.map((item) => [item.path, item.kind])).toEqual([[join(folder, 'src'), 'folder'], [join(folder, 'readme.md'), 'file']])
    expect(trashed[0]!.expiresAt - trashed[0]!.deletedAt).toBe(7 * 24 * 3600 * 1000)
    expect((await client.ok('trash.list', { under: tmpdir() + '-other' })).items).toEqual([])
    writeFileSync(join(folder, 'readme.md'), 'a new one')
    const [src, readme] = trashed
    expect(await client.fails('trash.restore', { id: readme!.id })).toMatchObject({ code: 'invalid_args' })
    expect(await client.ok('trash.restore', { id: src!.id })).toEqual({ path: join(folder, 'src') })
    expect(readFileSync(join(folder, 'src', 'a.ts'), 'utf8')).toBe('export {}')
    await client.ok('trash.delete', { id: readme!.id })
    expect((await client.ok('trash.list', {})).items).toEqual([])
    await client.ok('files.delete', { tabId: 'f', path: 'readme.md' })
    await client.ok('trash.empty', { under: folder })
    expect((await client.ok('trash.list', {})).items).toEqual([])
  })

  it('on the desktop deleted files go to the system trash', async () => {
    const trashed: string[] = []
    const folder = await filesTab({ trashItem: async (path) => void trashed.push(path) })
    await client.ok('files.delete', { tabId: 'f', path: 'readme.md' })
    expect(trashed).toEqual([join(folder, 'readme.md')])
  })

  it('attachments go to allegati/ under a free name, excluded from git on this machine only', async () => {
    const folder = await filesTab()
    const data = Buffer.from('%PDF').toString('base64')
    expect(await client.ok('files.write', { tabId: 'f', path: 'invoice.pdf', data, attachment: true })).toEqual({ path: 'allegati/invoice.pdf' })
    expect(await client.ok('files.write', { tabId: 'f', path: 'invoice.pdf', data, attachment: true })).toEqual({ path: 'allegati/invoice (2).pdf' })
    expect(readFileSync(join(folder, '.git', 'info', 'exclude'), 'utf8').match(/^allegati\/$/gm)).toHaveLength(1)
    expect(await client.fails('files.write', { tabId: 'f', path: '../x.pdf', data, attachment: true })).toMatchObject({ code: 'invalid_args' })
  })

  it('needs a trusted folder', async () => {
    await client.ok('tab.create', { tabId: 'u', cwd: mkdtempSync(join(tmpdir(), 'cw-untrusted-')) })
    expect(await client.fails('files.list', { tabId: 'u', path: '' })).toMatchObject({ code: 'needs_trust' })
  })

  it('a folder of the Home without a session: no trust needed, only inside the roots, one place per command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-home-files-'))
    mkdirSync(join(root, 'app'))
    writeFileSync(join(root, 'app', 'notes.txt'), 'hello')
    core = makeCore({ allowedRoots: [root], stateDir: mkdtempSync(join(tmpdir(), 'cw-home-files-state-')) })
    client = await connect(core)
    const folder = join(root, 'app')
    expect((await client.ok('files.list', { folder, path: '' })).entries.map((file) => file.name)).toEqual(['notes.txt'])
    expect(await client.ok('files.read', { folder, path: 'notes.txt' })).toMatchObject({ encoding: 'utf8', data: 'hello' })
    await client.ok('files.rename', { folder, from: 'notes.txt', to: 'todo.txt' })
    expect(readFileSync(join(folder, 'todo.txt'), 'utf8')).toBe('hello')
    expect(await client.fails('files.list', { folder: tmpdir(), path: '' })).toMatchObject({ code: 'outside_root' })
    expect(await client.fails('files.list', { path: '' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('files.list', { tabId: 'f', folder, path: '' })).toMatchObject({ code: 'invalid_args' })
  })
})

// Sub-phase B: notes of a folder, shared by every device (the 20% rule of "use in a message" is in packages/ui).
describe('notes', () => {
  it('per folder, newest first: saved, edited, deleted, announced to every client, kept across restarts', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-notes-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    const other = await connect(core, 'client-b')
    const { note: first } = await client.ok('notes.save', { cwd: CWD, text: 'first idea' })
    await tick(5)
    const { note: second } = await client.ok('notes.save', { cwd: CWD, text: 'second idea' })
    expect((await client.ok('notes.list', { cwd: CWD })).notes.map((note) => note.text)).toEqual(['second idea', 'first idea'])
    await client.ok('notes.save', { cwd: CWD, noteId: first.noteId, text: 'first, edited' })
    await client.ok('notes.delete', { cwd: CWD, noteId: second.noteId })
    await other.waitFor(() => other.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'notes.changed').length === 4)
    expect(other.events(WORKSPACE_STREAM).at(-1)).toEqual({ type: 'notes.changed', cwd: CWD })
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect((await client.ok('notes.list', { cwd: CWD })).notes).toMatchObject([{ noteId: first.noteId, text: 'first, edited' }])
    expect(await client.fails('notes.delete', { cwd: CWD, noteId: 'missing' })).toMatchObject({ code: 'not_found' })
    expect(await client.fails('notes.list', { cwd: join(CWD, 'missing') })).toMatchObject({ code: 'not_found' })
  })
})

// The Claude accounts of the backend (last accounts.updated seen by a client, or the snapshot's).
function accounts(of: RawClient): { accounts?: { accountId: string; name: string; addedAt: number }[]; defaultAccount?: string } {
  const event = of.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'accounts.updated').at(-1)
  if (event?.type === 'accounts.updated') return { accounts: event.accounts, defaultAccount: event.defaultAccount }
  const snapshot = of.lastReset(WORKSPACE_STREAM)?.snapshot as WorkspaceSnapshot | undefined
  return { accounts: snapshot?.accounts, defaultAccount: snapshot?.defaultAccount }
}

const TOKEN_B = 'sk-ant-oat01-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

// Accounts: Claude Code's own login of the backend, plus tokens made with `claude setup-token`; a session runs with
// its account, can switch keeping the conversation (as /login in the terminal), and a usage limit holds only the
// sessions of that account.
describe('accounts', () => {
  it('a token account is kept by the backend, listed by name only, saved owner-only and back after a restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-accounts-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(accounts(client).accounts).toEqual([])
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.waitFor(() => accounts(client).accounts?.length === 1)
    expect(accounts(client).accounts).toEqual([{ accountId, name: 'Second', addedAt: expect.any(Number) }])
    expect(JSON.stringify(client.frames)).not.toContain(TOKEN_B)
    if (process.platform !== 'win32') expect(statSync(join(stateDir, 'accounts.json')).mode & 0o777).toBe(0o600)
    expect(await client.fails('accounts.add', { name: 'Bad', token: 'my password' })).toMatchObject({ code: 'invalid_args' })
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    await client.waitFor(() => accounts(client).accounts?.length === 1)
    await client.ok('accounts.rename', { accountId, name: 'Work' })
    await client.waitFor(() => accounts(client).accounts?.[0]?.name === 'Work')
    expect(await client.fails('accounts.rename', { accountId: 'nobody', name: 'X' })).toMatchObject({ code: 'not_found' })
    await client.ok('accounts.remove', { accountId })
    await client.waitFor(() => accounts(client).accounts?.length === 0)
  })

  it("a session runs with its account's token, and with Claude Code's own login without one", async () => {
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.setAccount', { tabId: 't1', accountId })
    await client.ok('tab.send', { tabId: 't1', text: 'hello' }, cmd(1))
    await fake.last().waitForInput(1)
    expect(fake.last().options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN_B)
    await client.ok('tab.setAccount', { tabId: 't1', accountId: undefined })
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    await client.ok('tab.send', { tabId: 't2', text: 'hello' }, cmd(2))
    await client.waitFor(() => fake.sessions.length === 2)
    expect(fake.last().options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  it('switching the account keeps the conversation: the session restarts on the same stored session at the next message', async () => {
    const session = await startedTab()
    session.emit(sdk.init('s-acc'), sdk.success())
    await tick()
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('tab.setAccount', { tabId: 't1', accountId })
    await client.waitFor(() => session.closed)
    await client.waitFor(() => meta(client)?.status === 'dormant')
    expect(meta(client)).toMatchObject({ account: accountId, sessionId: 's-acc' })
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, cmd(2))
    await client.waitFor(() => fake.sessions.length === 2)
    expect(fake.last().options).toMatchObject({ resume: 's-acc', env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN_B }) })
    expect(items(client).filter((item) => item.kind === 'user').map((item) => item.itemId)).toEqual([cmd(1), cmd(2)])
  })

  it('a switch while Claude works stops the turn now: the session is marked stopped by the switch, and "Continua" resumes it with the new account', async () => {
    const session = await startedTab()
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('tab.setAccount', { tabId: 't1', accountId })
    await client.waitFor(() => session.calls.some((call) => call.method === 'interrupt'))
    expect(meta(client)?.interrupted).toBe('switch')
    session.emit(sdk.aborted())
    await client.waitFor(() => session.closed)
    await client.ok('tabs.continue', { text: 'continua' })
    await client.waitFor(() => fake.sessions.length === 2)
    await fake.last().waitForInput(1)
    expect(fake.last().options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN_B)
    expect(JSON.stringify(fake.last().received[0]!.message.content)).toContain('continua')
    expect(meta(client)?.interrupted).toBeUndefined()
  })

  it('the account is one for every session: switching it in one switches all of them and the new sessions', async () => {
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    await client.ok('tab.setAccount', { tabId: 't2', accountId })
    await client.waitFor(() => meta(client)?.account === accountId && meta(client, 't2')?.account === accountId)
    await client.waitFor(() => accounts(client).defaultAccount === accountId)
    await client.ok('accounts.setDefault', { accountId: undefined })
    await client.waitFor(() => meta(client)?.account === undefined && meta(client, 't2')?.account === undefined)
  })

  it('switching after a limit leaves the stopped session ready to continue; a message sent by hand, or "Continua" without text, clears the mark', async () => {
    const session = await startedTab()
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600), sdk.success())
    await client.waitFor(() => meta(client)?.interrupted === 'limit')
    await client.ok('tab.setAccount', { tabId: 't2', accountId })
    await client.waitFor(() => meta(client)?.account === accountId)
    expect(meta(client)).toMatchObject({ interrupted: 'limit' })
    expect(meta(client)?.limitedUntil).toBeUndefined()
    await client.ok('tabs.continue', {})
    await client.waitFor(() => meta(client)?.interrupted === undefined)
    expect(fake.sessions).toHaveLength(1)
  })

  it('the stopped mark survives a core restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-stopped-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    const session = await startedTab()
    session.emit(sdk.init('s-stopped'), sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600), sdk.success())
    await client.waitFor(() => meta(client)?.interrupted === 'limit')
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    expect(meta(client)).toMatchObject({ interrupted: 'limit' })
  })

  it('new sessions take the default account; a removed account sends its sessions back to the login', async () => {
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('accounts.setDefault', { accountId })
    await client.waitFor(() => accounts(client).defaultAccount === accountId)
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    expect(meta(client)?.account).toBe(accountId)
    expect(await client.fails('tab.setAccount', { tabId: 't1', accountId: 'nobody' })).toMatchObject({ code: 'not_found' })
    await client.ok('accounts.remove', { accountId })
    await client.waitFor(() => meta(client)?.account === undefined)
    expect(accounts(client).defaultAccount).toBeUndefined()
  })

  it("a limit reported by the old account's process, still finishing its turn after a switch, stays with the old account", async () => {
    const session = await startedTab()
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    await client.ok('tab.setAccount', { tabId: 't1', accountId })
    await client.waitFor(() => meta(client)?.account === accountId)
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600), sdk.aborted())
    await client.waitFor(() => session.closed)
    expect(meta(client)?.limitedUntil).toBeUndefined()
    await client.ok('tab.setAccount', { tabId: 't1', accountId: undefined })
    await client.waitFor(() => meta(client)?.limitedUntil !== undefined)
  })

  it('a turn that goes through lifts the limit recorded for its account', async () => {
    const session = await startedTab()
    session.emit(sdk.rateLimit('rejected', Math.ceil(Date.now() / 1000) + 3600), sdk.success())
    await client.waitFor(() => meta(client)?.limitedUntil !== undefined)
    await client.ok('tab.send', { tabId: 't1', text: 'it works again' }, cmd(2))
    await session.waitForInput(2)
    session.emit(sdk.success())
    await client.waitFor(() => meta(client)?.limitedUntil === undefined)
  })

  it('a usage limit belongs to its account: switching to another frees the sessions, switching back holds them again', async () => {
    const session = await startedTab()
    const { accountId } = await client.ok('accounts.add', { name: 'Second', token: TOKEN_B })
    const resetsAt = Math.ceil(Date.now() / 1000) + 3600
    session.emit(sdk.rateLimit('rejected', resetsAt), sdk.success())
    await client.waitFor(() => meta(client)?.limitedUntil === resetsAt * 1000)
    await client.ok('tab.setAccount', { tabId: 't1', accountId })
    await client.waitFor(() => meta(client)?.limitedUntil === undefined)
    await client.ok('tab.setAccount', { tabId: 't1', accountId: undefined })
    await client.waitFor(() => meta(client)?.limitedUntil === resetsAt * 1000)
  })
})

// Sub-phase B: model with version and the effort levels it offers, applied like /effort.
describe('model and effort', () => {
  it('an effort set on a dormant tab is passed at spawn; on a live one it goes through applyFlagSettings', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.setEffort', { tabId: 't1', effort: 'high' })
    await tick()
    expect(meta(client)?.effort).toBe('high')
    await client.ok('tab.send', { tabId: 't1', text: 'hi' }, cmd(1))
    const session = fake.last()
    expect(session.options).toMatchObject({ effort: 'high' })
    await client.ok('tab.setEffort', { tabId: 't1', effort: 'low' })
    expect(session.calls.at(-1)).toEqual({ method: 'applyFlagSettings', args: [{ effortLevel: 'low' }] })
    await client.ok('tab.setEffort', { tabId: 't1' })
    expect(session.calls.at(-1)).toEqual({ method: 'applyFlagSettings', args: [{ effortLevel: null }] })
    await tick()
    expect(meta(client)?.effort).toBeUndefined()
  })

  it('a model change keeps the effort when the model offers it, else takes its highest level below', async () => {
    const session = await startedTab()
    session.models = [
      { value: 'default', displayName: 'Opus 5.5', description: 'Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'sonnet', displayName: 'Sonnet 5', description: 'Fast', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
      { value: 'haiku', displayName: 'Haiku 4.5', description: 'Fastest' }
    ]
    expect((await client.ok('tab.models', { tabId: 't1' })).models[1]).toMatchObject({ value: 'sonnet', supportedEffortLevels: ['low', 'medium', 'high'] })
    await client.ok('tab.setEffort', { tabId: 't1', effort: 'max' })
    await client.ok('tab.setModel', { tabId: 't1', model: 'sonnet' })
    await tick()
    expect(meta(client)?.effort).toBe('high')
    expect(session.calls.at(-1)).toEqual({ method: 'applyFlagSettings', args: [{ effortLevel: 'high' }] })
    await client.ok('tab.setModel', { tabId: 't1', model: 'haiku' })
    await tick()
    expect(meta(client)?.effort).toBe('high')
  })

  it('the default effort and mode set in the app go to new tabs only; the ones given at creation win; cleared, none applies', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('settings.setDefaultEffort', { effort: 'high' })
    await client.ok('settings.setDefaultMode', { mode: 'acceptEdits' })
    const updates = (client.events(WORKSPACE_STREAM) as { type: string }[]).filter((ev) => ev.type === 'settings.updated')
    expect(updates.at(-1)).toEqual({ type: 'settings.updated', defaultEffort: 'high', defaultMode: 'acceptEdits' })
    await tick()
    expect(meta(client)).toMatchObject({ effort: undefined, mode: 'default' })
    await client.ok('tab.create', { tabId: 't2', cwd: CWD })
    expect(meta(client, 't2')).toMatchObject({ effort: 'high', mode: 'acceptEdits' })
    await client.ok('tab.send', { tabId: 't2', text: 'hi' }, cmd(1))
    expect(fake.last().options).toMatchObject({ effort: 'high', permissionMode: 'acceptEdits' })
    await client.ok('tab.create', { tabId: 't3', cwd: CWD, mode: 'plan' })
    expect(meta(client, 't3')).toMatchObject({ effort: 'high', mode: 'plan' })
    await client.ok('settings.setDefaultEffort', {})
    await client.ok('settings.setDefaultMode', {})
    await client.ok('tab.create', { tabId: 't4', cwd: CWD })
    expect(meta(client, 't4')).toMatchObject({ effort: undefined, mode: 'default' })
  })

  it('a default effort the model does not offer moves to its highest level below once the models are known', async () => {
    await client.ok('settings.setDefaultEffort', { effort: 'max' })
    const session = await startedTab()
    session.models = [{ value: 'default', displayName: 'Sonnet 5', description: 'Fast', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }]
    await client.ok('tab.models', { tabId: 't1' })
    await tick()
    expect(meta(client)?.effort).toBe('high')
    expect(session.calls.at(-1)).toEqual({ method: 'applyFlagSettings', args: [{ effortLevel: 'high' }] })
  })
})

// The palettes a client knows now: the last palettes.updated, else its workspace snapshot's.
function palettesOf(from: RawClient): Palette[] {
  const announced = from.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'palettes.updated').at(-1)
  if (announced?.type === 'palettes.updated') return announced.palettes
  return (from.lastReset(WORKSPACE_STREAM)?.snapshot as WorkspaceSnapshot).palettes ?? []
}

// Colour palettes of the app: saved on the backend so every device can pick them (which one is on is the device's).
describe('palettes', () => {
  const COLORS = { background: '#101418', surface: '#1a2027', text: '#e6edf3', accent: '#2f81f7', danger: '#f85149', success: '#3fb950' }

  it('saved, edited, deleted, announced to every client, kept across restarts', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-palettes-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    const other = await connect(core, 'client-b')
    const { palette } = await client.ok('palettes.save', { name: 'Night', colors: COLORS })
    expect(palette).toMatchObject({ name: 'Night', colors: COLORS })
    await client.ok('palettes.save', { paletteId: palette.paletteId, name: 'Night blue', colors: { ...COLORS, accent: '#58a6ff' } })
    const { palette: second } = await client.ok('palettes.save', { name: 'Spare', colors: COLORS })
    await client.ok('palettes.delete', { paletteId: second.paletteId })
    const mine = (palettes: { paletteId: string }[]) => palettes.filter((one) => !one.paletteId.startsWith('preset-'))
    const lastAnnounced = (from: typeof other) => from.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'palettes.updated').at(-1)
    await other.waitFor(() => {
      const last = lastAnnounced(other)
      return last?.type === 'palettes.updated' && mine(last.palettes).length === 1 && last.palettes.some((one) => one.name === 'Night blue')
    })
    const last = lastAnnounced(other)
    expect(last?.type === 'palettes.updated' && mine(last.palettes)).toMatchObject([{ paletteId: palette.paletteId, name: 'Night blue', colors: { accent: '#58a6ff' } }])
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    await tick()
    const snapshot = client.lastReset(WORKSPACE_STREAM)?.snapshot as WorkspaceSnapshot
    const announced = client.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'palettes.updated').at(-1)
    expect(mine(announced?.type === 'palettes.updated' ? announced.palettes : snapshot.palettes!)).toMatchObject([{ paletteId: palette.paletteId, name: 'Night blue' }])
  })

  it('a new backend starts with the preset palettes, once: a deleted one stays deleted after a restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-palettes-'))
    core = makeCore({ stateDir })
    client = await connect(core)
    await tick()
    expect(palettesOf(client).map((one) => one.paletteId)).toEqual(PRESET_PALETTES.map((preset) => preset.paletteId))
    await client.ok('palettes.save', { paletteId: DEFAULT_PALETTE_ID, name: 'Mine now', colors: COLORS })
    await client.ok('palettes.delete', { paletteId: PRESET_PALETTES[1]!.paletteId })
    await core.closeAll()
    core = makeCore({ stateDir })
    client = await connect(core)
    await tick()
    const after = palettesOf(client)
    expect(after.map((one) => one.paletteId)).toEqual(PRESET_PALETTES.filter((_, i) => i !== 1).map((preset) => preset.paletteId))
    expect(after.find((one) => one.paletteId === DEFAULT_PALETTE_ID)).toMatchObject({ name: 'Mine now', colors: COLORS })
  })

  it('a backend that already had palettes gets the presets after them, its own kept', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-palettes-'))
    const own = { paletteId: 'own-1', name: 'azzurro', colors: COLORS, updatedAt: 1 }
    writeFileSync(join(stateDir, 'palettes.json'), JSON.stringify([own]))
    core = makeCore({ stateDir })
    client = await connect(core)
    await tick()
    const list = palettesOf(client)
    expect(list.map((one) => one.paletteId)).toEqual(['own-1', ...PRESET_PALETTES.map((preset) => preset.paletteId)])
    expect(list[0]).toEqual(own)
  })

  it('refuses a colour that is not #rrggbb and an unknown palette', async () => {
    core = makeCore()
    client = await connect(core)
    expect(await client.fails('palettes.save', { name: 'Bad', colors: { ...COLORS, text: 'red' } })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('palettes.save', { paletteId: 'missing', name: 'Gone', colors: COLORS })).toMatchObject({ code: 'not_found' })
    expect(await client.fails('palettes.delete', { paletteId: 'missing' })).toMatchObject({ code: 'not_found' })
  })
})

// Core behaviour through the protocol, on the fake SDK. User stories of Phase 1:
// 1. I open a folder and chat: Claude's answer streams in;
// 2. Claude asks a permission / a question / a plan approval: I answer from any device, first answer wins;
// 3. I interrupt Claude, change mode and model;
// 4. I queue messages while Claude works and can take them back;
// 5. I reopen a past session and read it without starting anything;
// 6. reloads, dropped connections and retries never lose or duplicate anything.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { WORKSPACE_STREAM, tabStream, type Item, type TabMeta, type TabSnapshot, type WorkspaceEvent } from '@claude-wrap/protocol'
import { createCore, type Core, type CoreConfig } from './core.ts'
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

describe('queue', () => {
  it('a message sent during a turn is queued and dispatched at the end of the turn', async () => {
    const session = await startedTab()
    expect(await client.ok('tab.send', { tabId: 't1', text: 'next' }, cmd(2))).toEqual({ queued: true })
    expect(meta(client)?.queue).toEqual([{ queueId: cmd(2), text: 'next', from: 'client-a' }])
    expect(session.received).toHaveLength(1)
    session.emit(sdk.success())
    await session.waitForInput(2)
    await tick()
    expect(session.received[1]).toMatchObject({ uuid: cmd(2) })
    expect(meta(client)).toMatchObject({ queue: [], status: 'running' })
    expect(items(client).at(-1)).toMatchObject({ kind: 'user', itemId: cmd(2) })
  })

  it('a queued message can be removed before it is sent', async () => {
    const session = await startedTab()
    await client.ok('tab.send', { tabId: 't1', text: 'next' }, cmd(2))
    await client.ok('tab.unqueue', { tabId: 't1', queueId: cmd(2) })
    session.emit(sdk.success())
    await tick()
    expect(session.received).toHaveLength(1)
    expect(meta(client)).toMatchObject({ queue: [], status: 'idle' })
  })

  it('after an interrupted turn the queue stays', async () => {
    const session = await startedTab()
    await client.ok('tab.send', { tabId: 't1', text: 'next' }, cmd(2))
    session.emit(sdk.aborted())
    await tick()
    expect(session.received).toHaveLength(1)
    expect(meta(client)?.queue).toHaveLength(1)
  })

  it('a send already in the transcript (retry after a core restart) is not dispatched again', async () => {
    fake.histories.set('s1', [stored.user(cmd(9), 'hi')])
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    expect(await client.ok('tab.send', { tabId: 't1', text: 'hi' }, cmd(9))).toEqual({ queued: false })
    expect(fake.sessions.flatMap((session) => session.received)).toHaveLength(0)
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

  it('commands hide internal ones; models come from the CLI', async () => {
    await startedTab()
    expect((await client.ok('tab.commands', { tabId: 't1' })).commands.map((command) => command.name)).toEqual(['compact'])
    expect((await client.ok('tab.models', { tabId: 't1' })).models.map((model) => model.value)).toEqual(['default', 'haiku'])
  })
})

describe('close and process lifecycle', () => {
  it('closing denies pending requests, interrupts before closing, discards the queue and removes the tab', async () => {
    const session = await startedTab()
    await client.ok('tab.send', { tabId: 't1', text: 'queued' })
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
    const first = await client.cmd('tab.send', { tabId: 't1', text: 'again' }, cmd(7))
    const second = await client.cmd('tab.send', { tabId: 't1', text: 'again' }, cmd(7))
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

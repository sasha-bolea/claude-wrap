// Plans and caller keys through the protocol, on the fake SDK (Petra's way of using the app). User stories: from a
// terminal I create a key for a caller; with that key the caller proposes a plan (summary + steps in order) and I see
// it in the app; I approve or reject it; approved, the caller runs its steps only in that order with those arguments,
// nothing else, with no confirmation; a step may refer to an earlier step's result or carry free text; a "follow"
// step lets the caller answer Claude's requests in a chat until its turn ends; the app or the caller cancels a plan;
// a plan expires; keys and plans survive a core restart. A plan may also hold a choice between branches (the first
// step run takes one), steps the caller may skip and groups it may repeat up to N rounds; the caller ends it once only
// skippable steps are left; when an action fits two steps it may run now, the caller says which.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, planNext, tabStream, type Plan, type Request, type WorkspaceSnapshot } from '@athome/protocol'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { sdk } from './testing/messages.ts'
import { RawClient } from './testing/rawClient.ts'

const TERMINAL = { deviceId: 'terminal', label: 'terminal', terminal: true }
let root: string
let demo: string
let stateDir: string
let fake: FakeSdk
let core: Core
let app: RawClient
let person: RawClient
let key: string

// A core on this test's folders. extra: more configuration (a shorter plan life).
function makeCore(extra: Partial<CoreConfig> = {}): Core {
  return createCore({ backendId: 'test', backendKind: 'remote', sdk: fake, coalesceMs: 2, allowedRoots: [root], stateDir, ...extra })
}

// A connection of the caller with its key.
async function petra(of: Core = core): Promise<RawClient> {
  const client = new RawClient(of, 'athome-petra', TERMINAL)
  await client.hello({}, key)
  return client
}

// The plans the app sees now: from the latest of the last plans.updated event and the last workspace reset (a client
// that fell behind gets a reset with a fresh snapshot instead of the events).
function plans(of: RawClient = app): Plan[] {
  for (let index = of.frames.length - 1; index >= 0; index--) {
    const frame = of.frames[index]!
    if (frame.t === 'ev' && frame.stream === WORKSPACE_STREAM && frame.ev.type === 'plans.updated') return frame.ev.plans
    if (frame.t === 'reset' && frame.stream === WORKSPACE_STREAM) return (frame.snapshot as WorkspaceSnapshot).plans ?? []
  }
  return []
}

// The step numbers a plan allows next.
const nextOf = (plan: Plan | undefined): number[] => (plan ? planNext(plan.steps, plan.at).next.map((move) => move.number) : [])

// Proposes a plan as the caller and returns its id.
async function propose(caller: RawClient, steps: Plan['steps'], summary = 'Make a test project and greet it'): Promise<string> {
  return (await caller.ok('plans.propose', { summary, steps })).planId
}

// The caller runs one action under a plan; returns the reply frame.
const runStep = (caller: RawClient, planId: string, action: string, args: object, tabId?: string, step?: number) =>
  caller.cmd('actions.run', { action, args, source: 'terminal', plan: planId, ...(tabId ? { tabId } : {}), ...(step ? { step } : {}) })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-plans-'))
  demo = join(root, 'demo')
  mkdirSync(demo)
  stateDir = join(root, 'state')
  fake = createFakeSdk()
  core = makeCore()
  app = new RawClient(core)
  await app.hello()
  await app.ok('trust.grant', { cwd: root })
  person = new RawClient(core, 'athome-cli', TERMINAL)
  await person.hello()
  key = (await person.ok('callers.create', { name: 'petra', interactive: true })).key
})
afterEach(() => core.closeAll())

describe('caller keys', () => {
  it('a person at a terminal creates, lists and revokes them; the app and the caller itself cannot', async () => {
    expect((await person.ok('callers.list', { interactive: true })).callers.map((caller) => caller.name)).toEqual(['petra'])
    expect(await person.fails('callers.create', { name: 'petra', interactive: true })).toMatchObject({ code: 'invalid_args' })
    expect(await app.fails('callers.create', { name: 'other', interactive: true })).toMatchObject({ code: 'unauthorized' })
    const caller = await petra()
    expect(await caller.fails('callers.create', { name: 'other', interactive: true })).toMatchObject({ code: 'unauthorized' })
    await person.ok('callers.revoke', { name: 'petra', interactive: true })
    const revoked = new RawClient(core, 'athome-petra-2', TERMINAL)
    await revoked.hello({}, key)
    expect(revoked.fatal).toMatchObject({ code: 'unauthorized' })
  })

  it('an unknown key is refused; a key is useless on the app side', async () => {
    const wrong = new RawClient(core, 'athome-x', TERMINAL)
    await wrong.hello({}, 'not-a-key')
    expect(wrong.fatal).toMatchObject({ code: 'unauthorized' })
    const viaApp = new RawClient(core, 'app-2')
    await viaApp.hello({}, key)
    expect(await viaApp.fails('plans.propose', { summary: 'x', steps: [{ action: 'project.create', args: { name: 'a' } }] })).toMatchObject({ code: 'unauthorized' })
  })

  it('with a key and no plan, the caller may only read', async () => {
    const caller = await petra()
    expect(await caller.ok('folders.list', { path: root })).toMatchObject({ path: root })
    expect(await caller.fails('actions.run', { action: 'project.create', args: { name: 'idea' }, source: 'terminal', interactive: true })).toMatchObject({ code: 'action_denied' })
  })
})

describe('proposing and answering a plan', () => {
  it('the caller proposes; the app sees it, approves it; the terminal cannot answer', async () => {
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await app.waitFor(() => plans().some((plan) => plan.planId === planId))
    expect(plans()[0]).toMatchObject({ planId, caller: 'petra', status: 'proposed', summary: 'Make a test project and greet it' })
    expect(nextOf(plans()[0])).toEqual([1])
    expect(await caller.fails('plans.answer', { planId, decision: 'approve' })).toMatchObject({ code: 'unauthorized' })
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(plans()[0]).toMatchObject({ status: 'running' })
  })

  it('rejected: its steps cannot run', async () => {
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await app.ok('plans.answer', { planId, decision: 'reject' })
    expect(plans()).toEqual([])
    expect(await runStep(caller, planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(existsSync(join(root, 'idea'))).toBe(false)
  })

  it('refuses a plan with a bad reference or free text where it does not belong', async () => {
    const caller = await petra()
    const later = [{ action: 'session.start', args: { folder: { $step: 2, field: 'path' } } }, { action: 'project.create', args: { name: 'idea' } }] as Plan['steps']
    expect(await caller.fails('plans.propose', { summary: 'x', steps: later })).toMatchObject({ code: 'invalid_args' })
    const wrongField = [{ action: 'project.create', args: { name: 'idea' } }, { action: 'prompt.send', args: { tabId: { $step: 1, field: 'tabId' }, text: 'hi' } }] as Plan['steps']
    expect(await caller.fails('plans.propose', { summary: 'x', steps: wrongField })).toMatchObject({ code: 'invalid_args' })
    const freeName = [{ action: 'project.create', args: { name: { $free: true } } }] as Plan['steps']
    expect(await caller.fails('plans.propose', { summary: 'x', steps: freeName })).toMatchObject({ code: 'invalid_args' })
  })
})

describe('running a plan', () => {
  it('only the next step, with its arguments; results feed later steps; free text is the caller\'s; then it is done', async () => {
    const caller = await petra()
    const steps: Plan['steps'] = [
      { action: 'project.create', args: { name: 'idea' } },
      { action: 'session.start', args: { folder: { $step: 1, field: 'path' } } },
      { action: 'prompt.send', args: { tabId: { $step: 2, field: 'tabId' }, text: { $free: true } } }
    ]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    // Out of order, or other arguments: refused, nothing done.
    expect(await runStep(caller, planId, 'session.start', { folder: demo })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await runStep(caller, planId, 'project.create', { name: 'other' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await runStep(caller, planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: true, result: { value: { path: join(root, 'idea') } } })
    expect(plans()[0]).toMatchObject({ results: [{ path: join(root, 'idea') }] })
    expect(nextOf(plans()[0])).toEqual([2])
    const started = await runStep(caller, planId, 'session.start', { folder: join(root, 'idea') })
    const tabId = (started as { result: { value: { tabId: string } } }).result.value.tabId
    expect(await runStep(caller, planId, 'prompt.send', { text: 'ciao' }, tabId)).toMatchObject({ ok: true })
    await app.waitFor(() => fake.sessions.length === 1)
    await fake.last().waitForInput(1)
    expect(JSON.stringify(fake.last().received[0])).toContain('ciao')
    expect(plans()).toEqual([])
    expect(await runStep(caller, planId, 'prompt.send', { text: 'again' }, tabId)).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    // No confirmation was ever asked.
    expect(app.events(tabStream(tabId)).filter((ev) => ev.type === 'request.opened')).toEqual([])
    expect((await core.actionLog()).filter((entry) => entry.outcome === 'done').map((entry) => entry.plan)).toEqual([planId, planId, planId])
  })

  it('a failed step does not advance: the caller may retry it', async () => {
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'session.start', args: { folder: join(root, 'missing') } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'session.start', { folder: join(root, 'missing') })).toMatchObject({ ok: false })
    expect(plans()[0]).toMatchObject({ status: 'running' })
    expect(nextOf(plans()[0])).toEqual([1])
  })

  it('a session started by a plan asks for permissions, whatever the default', async () => {
    await app.ok('settings.setDefaultMode', { mode: 'acceptEdits' })
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'session.start', args: { folder: demo } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    const started = await runStep(caller, planId, 'session.start', { folder: demo })
    const tabId = (started as { result: { value: { tabId: string } } }).result.value.tabId
    const added = app.events(WORKSPACE_STREAM).find((ev) => ev.type === 'tab.added' && ev.tab.tabId === tabId)
    expect(added).toMatchObject({ tab: { mode: 'default' } })
  })
})

// The app's chat t1 with Claude at work; returns the fake process.
async function working() {
  await app.ok('tab.create', { tabId: 't1', cwd: demo })
  await app.ok('tab.subscribe', { tabId: 't1' })
  await app.ok('tab.send', { tabId: 't1', text: 'hello' })
  await app.waitFor(() => fake.sessions.length === 1)
  await fake.last().waitForInput(1)
  return fake.last()
}

// The queue of t1 as the app last saw it.
const queueOf = (tabId: string) => (app.events(WORKSPACE_STREAM).filter((ev) => (ev.type === 'tab.updated' || ev.type === 'tab.added') && ev.tab.tabId === tabId).at(-1) as { tab: { queue: unknown[] } } | undefined)?.tab.queue ?? []

describe('following a chat (session.follow)', () => {

  it("while Claude works, the caller answers that chat's requests; the step ends with the turn", async () => {
    const session = await working()
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'session.follow', args: { tabId: 't1' } }, { action: 'prompt.send', args: { tabId: 't1', text: 'next' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'session.follow', {}, 't1')).toMatchObject({ ok: true, result: { value: { following: true } } })
    expect(plans()[0]).toMatchObject({ following: 't1' })
    // Nothing else meanwhile.
    expect(await runStep(caller, planId, 'prompt.send', { text: 'next' }, 't1')).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    const pending = session.askPermission('Write', { file_path: 'a.txt', content: 'x' })
    await app.waitFor(() => app.events(tabStream('t1')).some((ev) => ev.type === 'request.opened'))
    expect(await runStep(caller, planId, 'request.answer', { decision: 'allow' }, 't1')).toMatchObject({ ok: true })
    expect(await pending.result).toMatchObject({ behavior: 'allow' })
    expect(plans()[0]).toMatchObject({ following: 't1' })
    session.emit(sdk.success())
    await app.waitFor(() => plans()[0]?.following === undefined)
    expect(nextOf(plans()[0])).toEqual([2])
    expect(await runStep(caller, planId, 'prompt.send', { text: 'next' }, 't1')).toMatchObject({ ok: true })
  })

  it('an idle chat: the step is over at once', async () => {
    await app.ok('tab.create', { tabId: 't1', cwd: demo })
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'session.follow', args: { tabId: 't1' } }, { action: 'project.create', args: { name: 'idea' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'session.follow', {}, 't1')).toMatchObject({ ok: true, result: { value: { following: false } } })
    expect(plans()[0]).not.toHaveProperty('following')
    expect(nextOf(plans()[0])).toEqual([2])
  })

  it('cannot answer the requests of another chat, nor outside a follow step', async () => {
    const session = await working()
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    session.askPermission('Write', { file_path: 'a.txt', content: 'x' })
    await app.waitFor(() => app.events(tabStream('t1')).some((ev) => ev.type === 'request.opened'))
    expect(await runStep(caller, planId, 'request.answer', { decision: 'allow' }, 't1')).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    const requests = app.events(tabStream('t1')).flatMap((ev) => (ev.type === 'request.opened' ? [ev.request as Request] : []))
    expect(requests).toHaveLength(1)
  })
})

describe('cancelling and expiring', () => {
  it('the app cancels a running plan; the caller cancels its own; then nothing runs', async () => {
    const caller = await petra()
    const first = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await app.ok('plans.answer', { planId: first, decision: 'approve' })
    await app.ok('plans.cancel', { planId: first })
    expect(await runStep(caller, first, 'project.create', { name: 'idea' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    const second = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await caller.ok('plans.cancel', { planId: second })
    expect(plans()).toEqual([])
    expect(await app.fails('plans.answer', { planId: second, decision: 'approve' })).toMatchObject({ code: 'request_resolved' })
  })

  it('a plan left half way expires', async () => {
    await core.closeAll()
    core = makeCore({ planTtlMs: 500 })
    app = new RawClient(core)
    await app.hello()
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    await app.waitFor(() => plans().length === 0, 5000)
    expect(await runStep(caller, planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
  })

  it('keys and a running plan survive a core restart, at the same step', async () => {
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'project.create', args: { name: 'idea' } }, { action: 'project.create', args: { name: 'more' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'project.create', { name: 'idea' })).toMatchObject({ ok: true })
    await core.closeAll()
    core = makeCore()
    app = new RawClient(core)
    await app.hello()
    expect(plans()).toMatchObject([{ planId, status: 'running' }])
    expect(nextOf(plans()[0])).toEqual([2])
    const again = await petra()
    expect(await runStep(again, planId, 'project.create', { name: 'more' })).toMatchObject({ ok: true })
    expect(plans()).toEqual([])
  })
})

describe('the other actions of a plan', () => {
  it('folders and the project mark: create a folder, mark it, unmark it', async () => {
    const caller = await petra()
    const steps: Plan['steps'] = [
      { action: 'folder.create', args: { parent: root, name: 'box' } },
      { action: 'project.mark', args: { path: { $step: 1, field: 'path' }, project: true } },
      { action: 'project.mark', args: { path: { $step: 1, field: 'path' }, project: false } }
    ]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'box' })).toMatchObject({ ok: true, result: { value: { path: join(root, 'box') } } })
    expect(existsSync(join(root, 'box'))).toBe(true)
    const projects = () => (app.events(WORKSPACE_STREAM).filter((ev) => ev.type === 'folders.updated').at(-1) as { projects: string[] } | undefined)?.projects ?? []
    expect(await runStep(caller, planId, 'project.mark', { path: join(root, 'box'), project: true })).toMatchObject({ ok: true })
    expect(projects()).toContain(join(root, 'box'))
    expect(await runStep(caller, planId, 'project.mark', { path: join(root, 'box'), project: false })).toMatchObject({ ok: true })
    expect(projects()).not.toContain(join(root, 'box'))
    expect(plans()).toEqual([])
  })

  it('the queue of a chat at work: add a message (free text), then take it out by its id', async () => {
    await working()
    const caller = await petra()
    const steps: Plan['steps'] = [
      { action: 'queue.add', args: { tabId: 't1', text: { $free: true } } },
      { action: 'queue.remove', args: { tabId: 't1', queueId: { $step: 1, field: 'queueId' } } }
    ]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    const added = await runStep(caller, planId, 'queue.add', { text: 'later' }, 't1')
    const queueId = (added as { result: { value: { queueId: string } } }).result.value.queueId
    await app.waitFor(() => queueOf('t1').length === 1)
    expect(await runStep(caller, planId, 'queue.remove', { queueId }, 't1')).toMatchObject({ ok: true })
    await app.waitFor(() => queueOf('t1').length === 0)
  })

  it('stops Claude and closes a chat', async () => {
    const session = await working()
    let interrupted = false
    session.onInterrupt(() => (interrupted = true))
    const caller = await petra()
    const planId = await propose(caller, [{ action: 'session.stop', args: { tabId: 't1' } }, { action: 'session.close', args: { tabId: 't1' } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'session.stop', {}, 't1')).toMatchObject({ ok: true })
    expect(interrupted).toBe(true)
    expect(await runStep(caller, planId, 'session.close', {}, 't1')).toMatchObject({ ok: true })
    expect(await app.fails('tab.subscribe', { tabId: 't1' })).toMatchObject({ code: 'not_found' })
  })

  it('belong to plans only: neither a widget nor a person at the terminal can use them', async () => {
    await app.ok('tab.create', { tabId: 't1', cwd: demo })
    expect(await app.fails('actions.run', { tabId: 't1', action: 'queue.add', args: { text: 'x' }, source: 'widget' })).toMatchObject({ code: 'action_denied' })
    expect(await app.fails('actions.run', { tabId: 't1', action: 'session.close', args: {}, source: 'widget' })).toMatchObject({ code: 'action_denied' })
    expect(await person.fails('actions.run', { action: 'folder.create', args: { parent: root, name: 'x' }, source: 'terminal', interactive: true })).toMatchObject({ code: 'action_denied' })
    expect(existsSync(join(root, 'x'))).toBe(false)
  })

  it('reading a chat from the terminal: subscribe and history, never the writes', async () => {
    await working()
    expect(await person.ok('tab.subscribe', { tabId: 't1' })).toEqual({})
    await person.waitFor(() => person.lastReset(tabStream('t1')) !== undefined)
    expect((await person.ok('tab.history', { tabId: 't1', beforeItemId: '', limit: 10 })).items).toBeDefined()
    expect(await person.fails('tab.queueAdd', { tabId: 't1', text: 'x' })).toMatchObject({ code: 'unauthorized' })
    const caller = await petra()
    expect(await caller.ok('tab.subscribe', { tabId: 't1' })).toEqual({})
  })
})

describe('plans with choices', () => {
  // A folder step of the plan: a plain folder in the test root.
  const box = (name: string): Plan['steps'][number] => ({ action: 'folder.create', args: { parent: root, name } })
  const made = (name: string) => existsSync(join(root, name))

  it('a choice: the first step run takes its branch; the other branch can no longer run', async () => {
    const caller = await petra()
    const steps: Plan['steps'] = [box('first'), { either: [{ if: 'the first went well', steps: [box('good'), box('better')] }, { if: 'otherwise', steps: [box('plan-b')] }] }, box('last')]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'first' })).toMatchObject({ ok: true })
    expect(nextOf(plans()[0])).toEqual([2, 4])
    const skipping = await runStep(caller, planId, 'folder.create', { parent: root, name: 'last' })
    expect(skipping).toMatchObject({ ok: false, error: { code: 'action_denied', message: expect.stringMatching(/step 2 .*step 4/) } })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'good' })).toMatchObject({ ok: true })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'plan-b' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'better' })).toMatchObject({ ok: true })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'last' })).toMatchObject({ ok: true })
    expect(plans()).toEqual([])
    expect([made('good'), made('better'), made('plan-b'), made('last')]).toEqual([true, true, false, true])
  })

  it('a group repeats up to its rounds; a skippable step is left; the caller ends the plan', async () => {
    await working()
    const caller = await petra()
    const steps: Plan['steps'] = [{ repeat: 2, if: 'until Claude has all it needs', steps: [{ action: 'queue.add', args: { tabId: 't1', text: { $free: true } } }] }, { ...box('wrap-up'), optional: true, if: 'if Claude asks for it' }]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'queue.add', { text: 'one' }, 't1')).toMatchObject({ ok: true })
    expect(await runStep(caller, planId, 'queue.add', { text: 'two' }, 't1')).toMatchObject({ ok: true })
    expect(await runStep(caller, planId, 'queue.add', { text: 'three' }, 't1')).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    await app.waitFor(() => queueOf('t1').length === 2)
    expect(await app.fails('plans.finish', { planId })).toMatchObject({ code: 'unauthorized' })
    await caller.ok('plans.finish', { planId })
    expect(plans()).toEqual([])
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'wrap-up' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
  })

  it('cannot be ended while a step it must run is left', async () => {
    const caller = await petra()
    const planId = await propose(caller, [box('needed'), { ...box('extra'), optional: true }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await caller.fails('plans.finish', { planId })).toMatchObject({ code: 'action_denied', message: expect.stringMatching(/cancel/) })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'needed' })).toMatchObject({ ok: true })
    await caller.ok('plans.finish', { planId })
    expect(plans()).toEqual([])
  })

  it('an action that fits two steps allowed now: the caller says which, and goes on that way', async () => {
    const caller = await petra()
    const steps: Plan['steps'] = [{ either: [{ if: 'x', steps: [box('same'), box('after-x')] }, { if: 'y', steps: [box('same'), box('after-y')] }] }]
    const planId = await propose(caller, steps)
    await app.ok('plans.answer', { planId, decision: 'approve' })
    const unsure = await runStep(caller, planId, 'folder.create', { parent: root, name: 'same' })
    expect(unsure).toMatchObject({ ok: false, error: { code: 'action_denied', message: expect.stringMatching(/steps 1 and 3.*step/) } })
    expect(made('same')).toBe(false)
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'same' }, undefined, 2)).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'same' }, undefined, 3)).toMatchObject({ ok: true })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'after-x' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await runStep(caller, planId, 'folder.create', { parent: root, name: 'after-y' })).toMatchObject({ ok: true })
    expect(plans()).toEqual([])
  })

  it('a step whose referenced step was skipped cannot run', async () => {
    const caller = await petra()
    const planId = await propose(caller, [{ ...box('maybe'), optional: true }, { action: 'project.mark', args: { path: { $step: 1, field: 'path' }, project: true } }])
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await runStep(caller, planId, 'project.mark', { path: join(root, 'maybe'), project: true })).toMatchObject({ ok: false, error: { code: 'action_denied', message: expect.stringMatching(/step 1/) } })
  })

  it('refuses a reference across branches, a condition on a step that must run, and choices nested too deep', async () => {
    const caller = await petra()
    const across: Plan['steps'] = [{ either: [{ if: 'x', steps: [box('a')] }, { if: 'y', steps: [{ action: 'project.mark', args: { path: { $step: 1, field: 'path' }, project: true } }] }] }]
    expect(await caller.fails('plans.propose', { summary: 'x', steps: across })).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/branch/) })
    expect(await caller.fails('plans.propose', { summary: 'x', steps: [{ ...box('a'), if: 'when I feel like it' }] })).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/optional/) })
    const deep: Plan['steps'] = [{ repeat: 2, steps: [{ either: [{ if: 'x', steps: [{ repeat: 2, steps: [box('a')] }] }, { if: 'y', steps: [] }] }] }]
    expect(await caller.fails('plans.propose', { summary: 'x', steps: deep })).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/deep/) })
    const many: Plan['steps'] = [{ repeat: 2, steps: Array.from({ length: 30 }, (_, index) => box(`a${index}`)) }, { repeat: 2, steps: Array.from({ length: 30 }, (_, index) => box(`b${index}`)) }]
    expect(await caller.fails('plans.propose', { summary: 'x', steps: many })).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/50/) })
  })
})

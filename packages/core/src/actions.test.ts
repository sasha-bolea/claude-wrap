// The action API (actions.run) through the protocol, on the fake SDK. User stories: a widget sends a prompt in its chat;
// heavy actions (create a project, start a session, allow a permission) first open a confirmation in the chat, and run
// only when the user allows them; a denied or cancelled one fails; actions of the app's screen are not core's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tabStream, type Request, type TabMeta, type WorkspaceEvent } from '@athome/protocol'
import { WORKSPACE_STREAM } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

const TAB = tabStream('t1')
let root: string
let cwd: string
let fake: FakeSdk
let core: Core
let client: RawClient

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-actions-'))
  cwd = join(root, 'demo')
  mkdirSync(cwd)
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'remote', sdk: fake, coalesceMs: 2, allowedRoots: [root] })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd })
  await client.ok('tab.subscribe', { tabId: 't1' })
})
afterEach(() => core.closeAll())

// Runs an action from a widget of t1 (the reply comes later for heavy actions).
const run = (action: string, args: object) => client.cmd('actions.run', { tabId: 't1', action, args, source: 'widget' })

// The requests t1 has opened so far.
const opened = () => client.events(TAB).flatMap((ev) => (ev.type === 'request.opened' ? [ev.request as Request] : []))

// Waits for t1's next confirmation of an action; returns it.
async function confirmation(count = 1): Promise<Request> {
  await client.waitFor(() => opened().filter((request) => request.kind === 'action').length >= count)
  return opened().filter((request) => request.kind === 'action')[count - 1]!
}

// The tabs the workspace announced.
const tabs = () => client.events(WORKSPACE_STREAM).flatMap((ev) => ((ev as WorkspaceEvent).type === 'tab.added' ? [(ev as Extract<WorkspaceEvent, { type: 'tab.added' }>).tab as TabMeta] : []))

describe('light actions', () => {
  it('prompt.send sends a message in the chat, at once', async () => {
    const reply = await run('prompt.send', { text: 'vai' })
    expect(reply).toMatchObject({ ok: true })
    await fake.last().waitForInput(1)
    expect(JSON.stringify(fake.last().received[0])).toContain('vai')
    expect(opened()).toHaveLength(0)
  })

  it('refuses unknown actions, bad arguments and actions of the screen', async () => {
    expect(await client.fails('actions.run', { tabId: 't1', action: 'shell.run', args: {}, source: 'widget' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('actions.run', { tabId: 't1', action: 'composer.insert', args: { text: 'x' }, source: 'widget' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('actions.run', { tabId: 't1', action: 'prompt.send', args: { text: '' }, source: 'widget' })).toMatchObject({ code: 'invalid_args' })
  })
})

describe('heavy actions ask first', () => {
  it('project.create: a confirmation in the chat; allowed, the folder is made and marked as a project', async () => {
    const reply = run('project.create', { name: 'idea' })
    const request = await confirmation()
    expect(request).toMatchObject({ kind: 'action', input: { action: 'project.create', args: { name: 'idea' }, source: 'widget' } })
    expect(existsSync(join(root, 'idea'))).toBe(false)
    await client.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'allow' })
    expect(await reply).toMatchObject({ ok: true, result: { value: { path: join(root, 'idea') } } })
    expect(existsSync(join(root, 'idea'))).toBe(true)
  })

  it('denied: the action fails with action_denied and nothing happens', async () => {
    const reply = run('project.create', { name: 'idea' })
    const request = await confirmation()
    await client.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'deny' })
    expect(await reply).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(existsSync(join(root, 'idea'))).toBe(false)
  })

  it('session.start: allowed, a new chat in that folder with its first prompt', async () => {
    const reply = run('session.start', { folder: cwd, prompt: 'start here' })
    const request = await confirmation()
    await client.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'allow' })
    const answer = await reply
    expect(answer).toMatchObject({ ok: true })
    const tabId = (answer as { result: { value: { tabId: string } } }).result.value.tabId
    expect(tabs().find((tab) => tab.tabId === tabId)).toMatchObject({ cwd })
    await client.waitFor(() => fake.sessions.length === 1)
    await fake.last().waitForInput(1)
    expect(JSON.stringify(fake.last().received[0])).toContain('start here')
  })

  it('session.start outside the Home is refused before asking', async () => {
    expect(await client.fails('actions.run', { tabId: 't1', action: 'session.start', args: { folder: tmpdir() }, source: 'widget' })).toMatchObject({ code: 'outside_root' })
    expect(opened()).toHaveLength(0)
  })

  it('a confirmation still open when the chat closes fails the action', async () => {
    const reply = run('project.create', { name: 'idea' })
    await confirmation()
    await client.ok('tab.close', { tabId: 't1' })
    expect(await reply).toMatchObject({ ok: false, error: { code: 'action_denied' } })
  })
})

describe('request.answer', () => {
  // Starts t1's process and has it ask for a tool; returns the pending result.
  async function asking(toolName: string, input: Record<string, unknown>) {
    await client.ok('tab.send', { tabId: 't1', text: 'hello' })
    await fake.last().waitForInput(1)
    const pending = fake.last().askPermission(toolName, input)
    await client.waitFor(() => opened().length === 1)
    return pending
  }

  it("answers a question at once with the widget's choices", async () => {
    const pending = await asking('AskUserQuestion', { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] })
    expect(await run('request.answer', { decision: 'allow', answers: { 'Which?': 'B' } })).toMatchObject({ ok: true })
    expect(await pending.result).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which?': 'B' } } })
  })

  it('allowing a permission asks for a confirmation first; denying one does not', async () => {
    const pending = await asking('Write', { file_path: 'a.txt', content: 'x' })
    const reply = run('request.answer', { decision: 'allow' })
    const request = await confirmation()
    expect(request.input).toMatchObject({ action: 'request.answer', args: { decision: 'allow' }, about: { toolName: 'Write' } })
    await client.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'allow' })
    expect(await reply).toMatchObject({ ok: true })
    expect(await pending.result).toMatchObject({ behavior: 'allow' })
  })

  it('with nothing to answer it fails with not_found', async () => {
    expect(await client.fails('actions.run', { tabId: 't1', action: 'request.answer', args: { decision: 'deny' }, source: 'widget' })).toMatchObject({ code: 'not_found' })
  })
})

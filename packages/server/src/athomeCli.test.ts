// The athome command against a real terminal socket and core (fake SDK). User stories: I list the projects and the
// open sessions (also as JSON); at a terminal I create a project and start a session with a first prompt at once;
// Claude, in an AtHome session, gets a confirmation in its chat and waits for my answer; any other program is refused;
// a wrong command line prints the usage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore, type Core } from '@athome/core'
import { createFakeSdk, RawClient, sdk, type FakeSdk } from '@athome/core/testing'
import { tabStream, type Request } from '@athome/protocol'
import { runCli, type CliIo } from './athomeCli.ts'
import { startTerminalSocket, type TerminalSocket } from './terminalSocket.ts'

let home: string
let path: string
let fake: FakeSdk
let core: Core
let socket: TerminalSocket
let out: string[]
let err: string[]

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-athome-'))
  home = join(root, 'home')
  mkdirSync(join(home, 'demo'), { recursive: true })
  path = join(root, 'state', 'terminal', 'athome.sock')
  fake = createFakeSdk()
  core = createCore({ backendId: 'server', backendKind: 'remote', sdk: fake, allowedRoots: [home] })
  socket = await startTerminalSocket(path, core.attach)
  out = []
  err = []
})
afterEach(async () => {
  await socket.close()
  await core.closeAll()
})

// Runs the command as a person at a terminal (interactive), or as a program (tabId: from an AtHome session).
const run = (argv: string[], io: Partial<CliIo> = {}) =>
  runCli(argv, { socket: path, cwd: home, interactive: true, out: (line) => out.push(line), err: (line) => err.push(line), ...io })

describe('athome', () => {
  it('lists the projects and the open sessions, as text or JSON', async () => {
    expect(await run(['project', 'create', 'idea'])).toBe(0)
    expect(await run(['session', 'start', 'demo'])).toBe(0)
    out = []
    expect(await run(['projects'])).toBe(0)
    expect(out).toEqual([`idea\t${join(home, 'idea')}`])
    out = []
    expect(await run(['sessions', '--json'])).toBe(0)
    expect(JSON.parse(out.join('\n'))).toEqual([expect.objectContaining({ cwd: join(home, 'demo'), status: 'dormant' })])
  })

  it('at a terminal: a project (in the Home or in a folder) and a session with its first prompt, at once', async () => {
    expect(await run(['project', 'create', 'idea', '--json'])).toBe(0)
    expect(JSON.parse(out[0]!)).toEqual({ path: join(home, 'idea') })
    expect(await run(['project', 'create', 'inner', '--in', 'demo'])).toBe(0)
    expect(existsSync(join(home, 'demo', 'inner'))).toBe(true)
    out = []
    expect(await run(['session', 'start', join(home, 'idea'), '--prompt', 'ciao'])).toBe(0)
    expect(out[0]).toMatch(/^Session started: /)
  })

  it('from a Claude session of AtHome: waits for the confirmation in its chat', async () => {
    const app = new RawClient(core)
    await app.hello()
    await app.ok('tab.create', { tabId: 't1', cwd: join(home, 'demo') })
    await app.ok('tab.subscribe', { tabId: 't1' })
    const done = run(['project', 'create', 'idea'], { interactive: false, tabId: 't1' })
    await app.waitFor(() => app.events(tabStream('t1')).some((ev) => ev.type === 'request.opened'))
    expect(err).toContain('Waiting for the confirmation in the AtHome chat…')
    const request = app.events(tabStream('t1')).flatMap((ev) => (ev.type === 'request.opened' ? [ev.request as Request] : []))[0]!
    await app.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'deny' })
    expect(await done).toBe(3)
    expect(err.at(-1)).toMatch(/not allowed/i)
    expect(existsSync(join(home, 'idea'))).toBe(false)
  })

  it('any other program is refused', async () => {
    expect(await run(['project', 'create', 'idea'], { interactive: false })).toBe(3)
    expect(existsSync(join(home, 'idea'))).toBe(false)
  })

  it('a wrong command line prints the usage; help prints it on stdout', async () => {
    expect(await run(['project', 'delete', 'x'])).toBe(2)
    expect(err.join('\n')).toContain('athome session start')
    expect(await run(['--help'])).toBe(0)
    expect(out.join('\n')).toContain('athome project create')
    expect(await run(['folder', 'create', 'x'])).toBe(2)
  })

  it('no server running: says so', async () => {
    await socket.close()
    expect(await run(['projects'])).toBe(1)
    expect(err.at(-1)).toMatch(/AtHome is not running/)
  })
})

describe('athome with a key (a caller such as Petra)', () => {
  let key: string
  let app: RawClient
  const asPetra = (argv: string[], plan?: string, extra: Partial<CliIo> = {}) => run(argv, { interactive: false, key, ...(plan ? { plan } : {}), ...extra })
  // The plans the app sees now (the latest of the last plans.updated event and the last workspace reset).
  const plans = (): { planId: string; status: string; cursor?: number }[] => {
    for (let index = app.frames.length - 1; index >= 0; index--) {
      const frame = app.frames[index]!
      if (frame.t === 'ev' && frame.stream === 'workspace' && frame.ev.type === 'plans.updated') return frame.ev.plans
      if (frame.t === 'reset' && frame.stream === 'workspace') return ((frame.snapshot as { plans?: { planId: string; status: string }[] }).plans ?? [])
    }
    return []
  }

  beforeEach(async () => {
    expect(await run(['key', 'create', 'petra', '--json'])).toBe(0)
    key = (JSON.parse(out[0]!) as { key: string }).key
    out = []
    app = new RawClient(core)
    await app.hello()
    await app.ok('trust.grant', { cwd: home })
  })

  it('keys: made, listed and revoked by hand; never by a program', async () => {
    expect(await run(['key', 'list'])).toBe(0)
    expect(out[0]).toMatch(/^petra\t/)
    expect(await run(['key', 'create', 'other'], { interactive: false })).toBe(3)
    expect(await run(['key', 'revoke', 'petra'])).toBe(0)
    expect(await asPetra(['projects'])).toBe(3)
    expect(err.at(-1)).toMatch(/revoked key/)
  })

  it('without a plan the caller may only read; a plan needs the key', async () => {
    expect(await asPetra(['projects'])).toBe(0)
    expect(await asPetra(['project', 'create', 'idea'])).toBe(3)
    const file = join(home, 'plan.json')
    writeFileSync(file, JSON.stringify({ summary: 'x', steps: [{ action: 'project.create', args: { name: 'idea' } }] }))
    expect(await run(['plan', 'propose', file], { interactive: false })).toBe(3)
  })

  it('a plan from a file, waited for and approved, then run step by step; status, read and wait on the chat', async () => {
    const file = join(home, 'plan.json')
    const steps = [{ action: 'project.create', args: { name: 'idea' } }, { action: 'session.start', args: { folder: { $step: 1, field: 'path' }, prompt: 'ciao' } }]
    writeFileSync(file, JSON.stringify({ summary: 'Make a test project and greet it', steps }))
    const proposing = asPetra(['plan', 'propose', file, '--wait'])
    await app.waitFor(() => plans().some((plan) => plan.status === 'proposed'))
    const planId = plans()[0]!.planId
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await proposing).toBe(0)
    expect(out.at(-1)).toBe(`${planId}\tapproved`)
    out = []
    expect(await asPetra(['plan', 'status', planId], planId)).toBe(0)
    expect(out[0]).toBe('running\tstep 1 of 2')
    expect(await asPetra(['session', 'start', join(home, 'idea')], planId)).toBe(3)
    expect(await asPetra(['project', 'create', 'idea'], planId)).toBe(0)
    expect(existsSync(join(home, 'idea'))).toBe(true)
    out = []
    expect(await asPetra(['session', 'start', join(home, 'idea'), '--prompt', 'ciao', '--json'], planId)).toBe(0)
    const { tabId } = JSON.parse(out[0]!) as { tabId: string }
    expect(await asPetra(['plan', 'status', planId], planId)).toBe(0)
    expect(out.at(-1)).toBe('closed')
    // Claude answers: wait prints its reply, read the conversation.
    await app.waitFor(() => fake.sessions.length === 1)
    await fake.last().waitForInput(1)
    const waiting = asPetra(['session', 'wait', tabId, '--timeout', '5'])
    fake.last().emit(sdk.assistant('m1', [{ type: 'text', text: 'hello back' }]), sdk.success())
    expect(await waiting).toBe(0)
    expect(out.at(-1)).toBe('claude: hello back')
    out = []
    expect(await asPetra(['session', 'read', tabId, '--last', '2'])).toBe(0)
    expect(out).toEqual(['user: ciao', 'claude: hello back'])
  })

  it('a rejected plan: --wait ends with 3 and nothing runs', async () => {
    const proposing = asPetra(['plan', 'propose', '-', '--wait'], undefined, { stdin: () => Promise.resolve(JSON.stringify({ summary: 'x', steps: [{ action: 'project.create', args: { name: 'idea' } }] })) })
    await app.waitFor(() => plans().some((plan) => plan.status === 'proposed'))
    const planId = plans()[0]!.planId
    await app.ok('plans.answer', { planId, decision: 'reject' })
    expect(await proposing).toBe(3)
    expect(await asPetra(['project', 'create', 'idea'], planId)).toBe(3)
  })

  it('the other commands of a plan: send, follow and answer, queue, stop, close, folder and mark', async () => {
    await app.ok('tab.create', { tabId: 't1', cwd: join(home, 'demo') })
    await app.ok('tab.subscribe', { tabId: 't1' })
    const steps = [
      { action: 'folder.create', args: { parent: home, name: 'box' } },
      { action: 'project.mark', args: { path: { $step: 1, field: 'path' }, project: true } },
      { action: 'prompt.send', args: { tabId: 't1', text: 'work' } },
      { action: 'session.follow', args: { tabId: 't1' } },
      { action: 'queue.add', args: { tabId: 't1', text: { $free: true } } },
      { action: 'queue.remove', args: { tabId: 't1', queueId: { $step: 5, field: 'queueId' } } },
      { action: 'session.stop', args: { tabId: 't1' } },
      { action: 'session.close', args: { tabId: 't1' } }
    ]
    const proposing = asPetra(['plan', 'propose', '-'], undefined, { stdin: () => Promise.resolve(JSON.stringify({ summary: 'everything', steps })) })
    expect(await proposing).toBe(0)
    const planId = out[0]!
    await app.ok('plans.answer', { planId, decision: 'approve' })
    expect(await asPetra(['folder', 'create', 'box', '--in', home], planId)).toBe(0)
    expect(await asPetra(['project', 'mark', join(home, 'box')], planId)).toBe(0)
    expect(await asPetra(['session', 'send', 't1', 'work'], planId)).toBe(0)
    await app.waitFor(() => fake.sessions.length === 1)
    await fake.last().waitForInput(1)
    out = []
    expect(await asPetra(['session', 'follow', 't1'], planId)).toBe(0)
    expect(out[0]).toMatch(/^Following/)
    const pending = fake.last().askPermission('Write', { file_path: 'a.txt', content: 'x' })
    await app.waitFor(() => app.events('tab:t1').some((ev) => ev.type === 'request.opened'))
    expect(await asPetra(['request', 'answer', 't1', 'allow'], planId)).toBe(0)
    expect(await pending.result).toMatchObject({ behavior: 'allow' })
    fake.last().emit(sdk.success())
    await app.waitFor(() => plans()[0]?.status === 'running' && (plans()[0] as { cursor?: number }).cursor === 4)
    out = []
    expect(await asPetra(['queue', 'add', 't1', 'later', '--json'], planId)).toBe(0)
    const { queueId } = JSON.parse(out[0]!) as { queueId: string }
    expect(await asPetra(['queue', 'remove', 't1', queueId], planId)).toBe(0)
    expect(await asPetra(['session', 'stop', 't1'], planId)).toBe(0)
    expect(await asPetra(['session', 'close', 't1'], planId)).toBe(0)
    expect(await app.fails('tab.subscribe', { tabId: 't1' })).toMatchObject({ code: 'not_found' })
    expect(plans()).toEqual([])
  })
})

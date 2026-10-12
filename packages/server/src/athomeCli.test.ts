// The athome command against a real terminal socket and core (fake SDK). User stories: I list the projects and the
// open sessions (also as JSON); at a terminal I create a project and start a session with a first prompt at once;
// Claude, in an AtHome session, gets a confirmation in its chat and waits for my answer; any other program is refused;
// anyone may wait for Claude's reply in a chat and read its last messages; a wrong command line prints the usage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
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

  it('session move: Claude asks to move its own session; allowed in the chat, it says when it moves', async () => {
    mkdirSync(join(home, 'other'))
    const app = new RawClient(core)
    await app.hello()
    await app.ok('tab.create', { tabId: 't1', cwd: join(home, 'demo') })
    await app.ok('tab.subscribe', { tabId: 't1' })
    const done = run(['session', 'move', 'other'], { interactive: false, tabId: 't1' })
    await app.waitFor(() => app.events(tabStream('t1')).some((ev) => ev.type === 'request.opened'))
    const request = app.events(tabStream('t1')).flatMap((ev) => (ev.type === 'request.opened' ? [ev.request as Request] : []))[0]!
    expect(request.input).toMatchObject({ action: 'session.move', args: { folder: join(home, 'other') } })
    await app.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'allow' })
    expect(await done).toBe(0)
    expect(out.at(-1)).toBe(`Session moved to ${join(home, 'other')}`)
  })

  it("terminal write and read: Claude types in its session's terminal once allowed, then reads the result", async () => {
    const app = new RawClient(core)
    await app.hello()
    await app.ok('trust.grant', { cwd: join(home, 'demo') })
    await app.ok('tab.create', { tabId: 't1', cwd: join(home, 'demo') })
    await app.ok('tab.subscribe', { tabId: 't1' })
    const done = run(['terminal', 'write', 'echo cw-"cl"i', '--enter'], { interactive: false, tabId: 't1' })
    await app.waitFor(() => app.events(tabStream('t1')).some((ev) => ev.type === 'request.opened'))
    const request = app.events(tabStream('t1')).flatMap((ev) => (ev.type === 'request.opened' ? [ev.request as Request] : []))[0]!
    await app.ok('request.answer', { tabId: 't1', requestId: request.requestId, decision: 'allow' })
    expect(await done).toBe(0)
    expect(out.at(-1)).toBe('Written in the terminal, Enter pressed')
    await expect
      .poll(async () => {
        out = []
        await run(['terminal', 'read', '--lines', '20'], { interactive: false, tabId: 't1' })
        return out.join('\n')
      }, { timeout: 5000 })
      .toContain('cw-cli')
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
    expect(await run(['session', 'send', 't1', 'x'])).toBe(2)
  })

  it('reads a chat: wait prints Claude\'s reply once its turn is over, read the last messages', async () => {
    const app = new RawClient(core)
    await app.hello()
    await app.ok('trust.grant', { cwd: home })
    out = []
    expect(await run(['session', 'start', 'demo', '--prompt', 'ciao', '--json'])).toBe(0)
    const { tabId } = JSON.parse(out[0]!) as { tabId: string }
    await app.waitFor(() => fake.sessions.length === 1)
    await fake.last().waitForInput(1)
    const waiting = run(['session', 'wait', tabId, '--timeout', '5'], { interactive: false })
    fake.last().emit(sdk.assistant('m1', [{ type: 'text', text: 'hello back' }]), sdk.success())
    expect(await waiting).toBe(0)
    expect(out.at(-1)).toBe('claude: hello back')
    out = []
    expect(await run(['session', 'read', tabId, '--last', '2'], { interactive: false })).toBe(0)
    expect(out).toEqual(['user: ciao', 'claude: hello back'])
  })

  it('no server running: says so', async () => {
    await socket.close()
    expect(await run(['projects'])).toBe(1)
    expect(err.at(-1)).toMatch(/AtHome is not running/)
  })
})

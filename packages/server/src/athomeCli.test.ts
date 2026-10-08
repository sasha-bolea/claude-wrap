// The athome command against a real terminal socket and core (fake SDK). User stories: I list the projects and the
// open sessions (also as JSON); at a terminal I create a project and start a session with a first prompt at once;
// Claude, in an AtHome session, gets a confirmation in its chat and waits for my answer; any other program is refused;
// a wrong command line prints the usage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore, type Core } from '@athome/core'
import { createFakeSdk, RawClient } from '@athome/core/testing'
import { tabStream, type Request } from '@athome/protocol'
import { runCli, type CliIo } from './athomeCli.ts'
import { startTerminalSocket, type TerminalSocket } from './terminalSocket.ts'

let home: string
let path: string
let core: Core
let socket: TerminalSocket
let out: string[]
let err: string[]

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-athome-'))
  home = join(root, 'home')
  mkdirSync(join(home, 'demo'), { recursive: true })
  path = join(root, 'state', 'terminal', 'athome.sock')
  core = createCore({ backendId: 'server', backendKind: 'remote', sdk: createFakeSdk(), allowedRoots: [home] })
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
  })

  it('no server running: says so', async () => {
    await socket.close()
    expect(await run(['projects'])).toBe(1)
    expect(err.at(-1)).toMatch(/AtHome is not running/)
  })
})

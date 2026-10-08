// The terminal socket of the remote server (the athome command's way in): a Unix socket in a folder only its user can
// open, whose connections core treats as the terminal (action API and folder list only, no token).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createCore, type Core } from '@athome/core'
import { createFakeSdk } from '@athome/core/testing'
import { PROTOCOL_VERSION } from '@athome/protocol'
import { startTerminalSocket, type TerminalSocket } from './terminalSocket.ts'

let root: string
let path: string
let core: Core
let socket: TerminalSocket

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-terminal-'))
  mkdirSync(join(root, 'home'))
  path = join(root, 'state', 'terminal', 'athome.sock')
  core = createCore({ backendId: 'server', backendKind: 'remote', sdk: createFakeSdk(), allowedRoots: [join(root, 'home')] })
  socket = await startTerminalSocket(path, core.attach)
})
afterEach(async () => {
  await socket.close()
  await core.closeAll()
})

// Opens the socket, says hello; returns a function that sends a command and resolves with its reply frame.
async function connect(): Promise<{ cmd: (name: string, args: object) => Promise<Record<string, unknown>>; close: () => void }> {
  const ws = new WebSocket(`ws+unix://${path}:/ws`)
  const frames: Record<string, unknown>[] = []
  const waiters: (() => void)[] = []
  ws.on('message', (data) => (frames.push(JSON.parse(data.toString()) as Record<string, unknown>), waiters.splice(0).forEach((wake) => wake())))
  await new Promise<void>((resolve, reject) => (ws.once('open', () => resolve()), ws.once('error', reject)))
  const next = async (match: (frame: Record<string, unknown>) => boolean) => {
    while (!frames.some(match)) await new Promise<void>((wake) => waiters.push(wake))
    return frames.find(match)!
  }
  ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'athome-cli', visible: false, resume: {} }))
  await next((frame) => frame.t === 'welcome')
  const cmd = (name: string, args: object) => {
    const id = crypto.randomUUID()
    ws.send(JSON.stringify({ t: 'cmd', id, name, args }))
    return next((frame) => frame.t === 'reply' && frame.id === id)
  }
  return { cmd, close: () => ws.close() }
}

describe('terminal socket', () => {
  it('lives in a folder only its user can open, and only its user can use it', () => {
    expect(statSync(join(root, 'state', 'terminal')).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('its connections are the terminal: actions without a token, nothing else of the protocol', async () => {
    const terminal = await connect()
    expect(await terminal.cmd('actions.run', { action: 'project.create', args: { name: 'test' }, source: 'terminal', interactive: true })).toMatchObject({ ok: true })
    expect(existsSync(join(root, 'home', 'test'))).toBe(true)
    expect(await terminal.cmd('trust.grant', { cwd: join(root, 'home') })).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    terminal.close()
  })

  it('replaces a socket file left by a server that died; never anything else', async () => {
    await socket.close()
    socket = await startTerminalSocket(path, core.attach)
    const terminal = await connect()
    expect(await terminal.cmd('folders.list', { path: join(root, 'home') })).toMatchObject({ ok: true })
    terminal.close()
    const other = join(root, 'state', 'terminal', 'not-a-socket')
    writeFileSync(other, 'mine')
    await expect(startTerminalSocket(other, core.attach)).rejects.toThrow(/not a socket/)
  })
})

// Terminals through the protocol, with a real shell (node-pty). User stories: I open a terminal in a session's folder
// or a folder of the Home and type in it; every device sees it in the list and the same screen; a device that comes
// back after a reconnection gets what it missed; a shell that ends says so; I close it; at most 5 at a time; never
// outside the server's root.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, terminalStream, type TerminalMeta, type TerminalSnapshot, type WorkspaceEvent, type WorkspaceSnapshot } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'cw-term-'))
const CWD = join(ROOT, 'demo')
mkdirSync(CWD)

let core: Core
let client: RawClient

// A raw client past hello, with the test folder trusted.
async function connect(clientId?: string, resume = {}): Promise<RawClient> {
  const raw = new RawClient(core, clientId)
  await raw.hello(resume)
  await raw.ok('trust.grant', { cwd: CWD })
  return raw
}

// Terminals of the workspace as a client sees them: last snapshot + following events.
function terminals(of: RawClient): TerminalMeta[] {
  const reset = of.lastReset(WORKSPACE_STREAM)
  let list = [...((reset?.snapshot as WorkspaceSnapshot | undefined)?.terminals ?? [])]
  for (const frame of of.frames.slice(reset ? of.frames.lastIndexOf(reset) + 1 : 0)) {
    if (frame.t !== 'ev' || frame.stream !== WORKSPACE_STREAM) continue
    const ev = frame.ev as WorkspaceEvent
    if (ev.type === 'terminal.added') list.push(ev.terminal)
    if (ev.type === 'terminal.updated') list = list.map((terminal) => (terminal.terminalId === ev.terminal.terminalId ? ev.terminal : terminal))
    if (ev.type === 'terminal.removed') list = list.filter((terminal) => terminal.terminalId !== ev.terminalId)
  }
  return list
}

// Everything a client has of a terminal's screen: the snapshot's text + the output after it.
function screen(of: RawClient, terminalId: string): string {
  const stream = terminalStream(terminalId)
  const reset = of.lastReset(stream)
  let text = (reset?.snapshot as TerminalSnapshot | undefined)?.screen ?? ''
  for (const frame of of.frames.slice(reset ? of.frames.lastIndexOf(reset) + 1 : 0)) {
    if (frame.t === 'ev' && frame.stream === stream && frame.ev.type === 'terminal.output') text += frame.ev.data
  }
  return text
}

beforeEach(async () => {
  core = createCore({ backendId: 'test', backendKind: 'remote', sdk: createFakeSdk(), allowedRoots: [ROOT], coalesceMs: 2 })
  client = await connect()
})
afterEach(async () => {
  client.close()
  await core.closeAll()
})

describe('terminals', () => {
  it('opens a shell in a folder of the Home, listed for every client; what I type runs and its output reaches me', async () => {
    const other = await connect('client-b')
    const { terminalId } = await client.ok('terminal.open', { folder: CWD, cols: 90, rows: 30 })
    expect(terminals(other)).toEqual([expect.objectContaining({ terminalId, cwd: CWD, title: 'demo', cols: 90, rows: 30 })])
    await client.ok('terminal.subscribe', { terminalId })
    await client.ok('terminal.input', { terminalId, data: 'echo cw-"mark"er\r' })
    await client.waitFor(() => screen(client, terminalId).includes('cw-marker'), 5000)
    // The other device subscribing later gets the same screen in its snapshot.
    await other.ok('terminal.subscribe', { terminalId })
    expect((other.lastReset(terminalStream(terminalId))?.snapshot as TerminalSnapshot).screen).toContain('cw-marker')
    await client.ok('terminal.resize', { terminalId, cols: 120, rows: 40 })
    await other.waitFor(() => terminals(other)[0]?.cols === 120)
    other.close()
  })

  it('a session folder works too; a shell that ends is marked with its exit code until I close it', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    const { terminalId } = await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    expect(terminals(client)[0]).toMatchObject({ terminalId, cwd: CWD, tabId: 't1' })
    await client.ok('terminal.subscribe', { terminalId })
    await client.ok('terminal.input', { terminalId, data: 'exit 3\r' })
    await client.waitFor(() => terminals(client)[0]?.exitCode === 3, 5000)
    expect(client.events(terminalStream(terminalId))).toContainEqual({ type: 'terminal.exit', exitCode: 3 })
    await client.ok('terminal.close', { terminalId })
    expect(terminals(client)).toEqual([])
    expect(await client.fails('terminal.input', { terminalId, data: 'x' })).toMatchObject({ code: 'not_found' })
  })

  it('a client back after a reconnection gets the output it missed', async () => {
    const { terminalId } = await client.ok('terminal.open', { folder: CWD, cols: 80, rows: 24 })
    await client.ok('terminal.subscribe', { terminalId })
    await client.ok('terminal.input', { terminalId, data: 'echo first-"o"ne\r' })
    await client.waitFor(() => screen(client, terminalId).includes('first-one'), 5000)
    const stream = terminalStream(terminalId)
    const last = client.frames.filter((frame) => frame.t === 'ev' && frame.stream === stream).at(-1) as { epoch: string; seq: number }
    client.close()
    const helper = await connect('client-c')
    await helper.ok('terminal.input', { terminalId, data: 'echo second-"o"ne\r' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    client = await connect('client-a', { [stream]: { epoch: last.epoch, lastSeq: last.seq } })
    await client.waitFor(() => client.events(stream).some((ev) => ev.type === 'terminal.output' && ev.data.includes('second-one')), 5000)
    expect(client.lastReset(stream)).toBeUndefined()
    helper.close()
  })

  it('at most 5 terminals; never outside the root; a stream of a closed terminal is gone', async () => {
    const ids: string[] = []
    for (let n = 0; n < 5; n += 1) ids.push((await client.ok('terminal.open', { folder: CWD, cols: 80, rows: 24 })).terminalId)
    expect(await client.fails('terminal.open', { folder: CWD, cols: 80, rows: 24 })).toMatchObject({ code: 'limit_reached' })
    expect(await client.fails('terminal.open', { folder: tmpdir(), cols: 80, rows: 24 })).toMatchObject({ code: 'outside_root' })
    await client.ok('terminal.close', { terminalId: ids[0]! })
    const back = new RawClient(core, 'client-d')
    await back.hello({ [terminalStream(ids[0]!)]: { epoch: 'x', lastSeq: 1 } })
    await back.waitFor(() => back.frames.some((frame) => frame.t === 'gone' && frame.stream === terminalStream(ids[0]!)))
    back.close()
  })

  // The automatic update restarts the server only while nothing works: a command running in a terminal counts.
  it.skipIf(process.platform === 'win32')('a command running in a terminal counts as work in the activity file; the shell at its prompt does not', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cw-term-activity-')), 'activity.json')
    const working = () => {
      try {
        return (JSON.parse(readFileSync(file, 'utf8')) as { working: number }).working
      } catch {
        return undefined
      }
    }
    client.close()
    await core.closeAll()
    core = createCore({ backendId: 'test', backendKind: 'remote', sdk: createFakeSdk(), allowedRoots: [ROOT], coalesceMs: 2, activityFile: file, activityPollMs: 30 })
    client = await connect()
    const { terminalId } = await client.ok('terminal.open', { folder: CWD, cols: 80, rows: 24 })
    // At its prompt (once its start-up files ran) the shell is not work.
    await expect.poll(working, { timeout: 5000 }).toBe(0)
    await client.ok('terminal.input', { terminalId, data: 'sleep 1\r' })
    await expect.poll(working, { timeout: 3000 }).toBe(1)
    await expect.poll(working, { timeout: 5000 }).toBe(0)
  })
})

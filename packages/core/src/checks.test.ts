// User story: I tick a box of a checklist Claude wrote in the chat; it stays ticked after a reload, on my other
// devices, and when I close the session and open it again; a forked or deleted session does not keep it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, type WorkspaceEvent } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

const CWD = join(mkdtempSync(join(tmpdir(), 'cw-checks-')), 'demo')
mkdirSync(CWD)

let fake: FakeSdk
let cores: Core[]

// A core on the fake SDK; stateDir: where it keeps its files (absent: memory only).
function makeCore(stateDir?: string): Core {
  const core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, stateDir })
  cores.push(core)
  return core
}

// A raw client past hello, with the test folder trusted.
async function connect(to: Core): Promise<RawClient> {
  const raw = new RawClient(to)
  await raw.hello()
  await raw.ok('trust.grant', { cwd: CWD })
  return raw
}

// The checks.changed events a client heard, as tab ids.
const changed = (of: RawClient) => (of.events(WORKSPACE_STREAM) as WorkspaceEvent[]).flatMap((ev) => (ev.type === 'checks.changed' ? [ev.tabId] : []))

beforeEach(() => {
  fake = createFakeSdk()
  cores = []
})
afterEach(() => cores.forEach((core) => core.closeAll()))

describe('checklist ticks', () => {
  it('a tick is kept per message and box, and every client hears about it', async () => {
    const core = makeCore()
    const [a, b] = [await connect(core), await connect(core)]
    await a.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    expect(await a.ok('tab.checks', { tabId: 't1' })).toEqual({ checks: {} })
    await a.ok('tab.setCheck', { tabId: 't1', itemId: 'msg_1:0', index: 2, checked: true })
    await a.ok('tab.setCheck', { tabId: 't1', itemId: 'msg_1:0', index: 0, checked: false })
    await a.ok('tab.setCheck', { tabId: 't1', itemId: 'msg_2:1', index: 0, checked: true })
    expect(await b.ok('tab.checks', { tabId: 't1' })).toEqual({ checks: { 'msg_1:0': { 2: true, 0: false }, 'msg_2:1': { 0: true } } })
    expect(changed(b)).toEqual(['t1', 't1', 't1'])
  })

  it('an item id that names an object property is refused (it would reach the prototype)', async () => {
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    for (const itemId of ['__proto__', 'constructor']) {
      expect((await client.fails('tab.setCheck', { tabId: 't1', itemId, index: 0, checked: true })).code).toBe('not_found')
    }
    expect(({} as Record<string, unknown>)[0]).toBeUndefined()
    expect(await client.ok('tab.checks', { tabId: 't1' })).toEqual({ checks: {} })
  })

  it('a session without a stored conversation has nothing to tick', async () => {
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    expect(await client.ok('tab.checks', { tabId: 't1' })).toEqual({ checks: {} })
    expect((await client.fails('tab.setCheck', { tabId: 't1', itemId: 'msg_1:0', index: 0, checked: true })).code).toBe('not_found')
  })

  it('ticks follow the session: closed and reopened, and after a restart of the core', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-checks-state-'))
    const first = await connect(makeCore(stateDir))
    await first.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await first.ok('tab.setCheck', { tabId: 't1', itemId: 'msg_1:0', index: 1, checked: true })
    await first.ok('tab.close', { tabId: 't1' })
    await first.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's1' })
    expect(await first.ok('tab.checks', { tabId: 't2' })).toEqual({ checks: { 'msg_1:0': { 1: true } } })
    await cores[0]!.closeAll()
    const second = await connect(makeCore(stateDir))
    // The tab comes back dormant: opening the session again returns it.
    const { tabId } = await second.ok('tab.create', { tabId: 't3', cwd: CWD, resume: 's1' })
    expect(await second.ok('tab.checks', { tabId })).toEqual({ checks: { 'msg_1:0': { 1: true } } })
  })

  it('another session does not see them, and deleting the session drops them', async () => {
    const client = await connect(makeCore())
    await client.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
    await client.ok('tab.create', { tabId: 't2', cwd: CWD, resume: 's2' })
    await client.ok('tab.setCheck', { tabId: 't1', itemId: 'msg_1:0', index: 0, checked: true })
    expect(await client.ok('tab.checks', { tabId: 't2' })).toEqual({ checks: {} })
    await client.ok('tab.close', { tabId: 't1' })
    await client.ok('sessions.delete', { cwd: CWD, sessionId: 's1' })
    await client.ok('tab.create', { tabId: 't3', cwd: CWD, resume: 's1' })
    expect(await client.ok('tab.checks', { tabId: 't3' })).toEqual({ checks: {} })
  })
})

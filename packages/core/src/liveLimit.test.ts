// User story: I open chat after chat over days; a new one never fails because old ones I left idle still hold their
// CLI process. At the limit the least recently used idle chat gives its process back (it starts again on its next
// message); a chat where Claude works, asks something, has a queue or runs work in the background is never stopped.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'
import { sdk } from './testing/messages.ts'

const CWD = join(mkdtempSync(join(tmpdir(), 'cw-live-')), 'demo')
mkdirSync(CWD)
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

let fake: FakeSdk
let core: Core
let client: RawClient

// The CLI's level signal of the live background tasks (REPLACE semantics).
const backgroundTasks = (tasks: { task_id: string; ambient?: boolean }[]) =>
  ({ type: 'system', subtype: 'background_tasks_changed', tasks: tasks.map((task) => ({ task_type: 'local_bash', description: 'x', ...task })), uuid: crypto.randomUUID(), session_id: 's' }) as unknown as SDKMessage

// Opens a tab, sends a message and lets its turn end: an idle chat holding a process. Returns its fake session.
// finish: false leaves Claude working.
async function idleChat(tabId: string, finish = true) {
  await client.ok('tab.create', { tabId, cwd: CWD })
  await client.ok('tab.send', { tabId, text: 'hello' }, crypto.randomUUID())
  const session = fake.last()
  await session.waitForInput(1)
  session.emit(sdk.init(`s-${tabId}`))
  if (finish) session.emit(sdk.success())
  await tick(15)
  return session
}

beforeEach(async () => {
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, maxLiveSessions: 2 })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd: CWD })
})
afterEach(() => core.closeAll())

describe('live sessions limit', () => {
  it('at the limit the least recently used idle chat gives its process back, and starts again on its next message', async () => {
    const a = await idleChat('a')
    const b = await idleChat('b')
    await idleChat('c')
    expect(a.closed).toBe(true)
    expect(b.closed).toBe(false)
    // a comes back on its next message, b (now the least recently used) gives its process back.
    await client.ok('tab.send', { tabId: 'a', text: 'again' }, crypto.randomUUID())
    await tick(15)
    expect(b.closed).toBe(true)
    expect(fake.sessions).toHaveLength(4)
  })

  it('never stops a chat with work in the background, nor one where Claude works', async () => {
    const a = await idleChat('a')
    a.emit(backgroundTasks([{ task_id: 't1' }]))
    const b = await idleChat('b', false)
    await client.ok('tab.create', { tabId: 'c', cwd: CWD })
    expect((await client.fails('tab.send', { tabId: 'c', text: 'hi' })).code).toBe('limit_reached')
    expect([a.closed, b.closed]).toEqual([false, false])
    // Ambient tasks (watchers) are not work: once only those remain, a can give its process back.
    a.emit(backgroundTasks([{ task_id: 't2', ambient: true }]))
    await tick(15)
    await client.ok('tab.send', { tabId: 'c', text: 'hi' }, crypto.randomUUID())
    await tick(15)
    expect(a.closed).toBe(true)
  })
})

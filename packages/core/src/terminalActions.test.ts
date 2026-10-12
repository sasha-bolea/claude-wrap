// Claude and the terminal of its session (actions terminal.read / terminal.write through the athome command), with a
// real shell. User stories: Claude in an AtHome session reads what its session's terminal shows, without asking;
// it writes in it only after I allow it in the chat (once, or always for this session), with or without Enter; with
// no terminal open it opens one in the session's folder; nothing else may read or write it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, tabStream, type Request, type TerminalMeta, type WorkspaceEvent } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

let root: string
let cwd: string
let core: Core
let client: RawClient
let terminal: RawClient

// The action requests t1 opened so far.
const cards = () => client.events(tabStream('t1')).flatMap((ev) => (ev.type === 'request.opened' && (ev.request as Request).kind === 'action' ? [ev.request as Request] : []))
// Runs an action as Claude in the AtHome session t1 (the athome command from its Bash tool).
const fromClaude = (action: string, args: object) => terminal.cmd('actions.run', { action, args, source: 'terminal', tabId: 't1' })
// The terminals the workspace announced (opened, not yet removed).
const opened = () => client.events(WORKSPACE_STREAM).flatMap((ev) => ((ev as WorkspaceEvent).type === 'terminal.added' ? [(ev as Extract<WorkspaceEvent, { type: 'terminal.added' }>).terminal as TerminalMeta] : []))
// What terminal.read gives Claude now.
async function read(): Promise<string> {
  const reply = (await fromClaude('terminal.read', {})) as { ok: boolean; result?: { value: { text: string } } }
  return reply.result?.value.text ?? ''
}
// Allows t1's count-th action card (decision: allow or allowAlways).
async function allow(count: number, decision: 'allow' | 'allowAlways' = 'allow'): Promise<Request> {
  await client.waitFor(() => cards().length >= count)
  const card = cards()[count - 1]!
  await client.ok('request.answer', { tabId: 't1', requestId: card.requestId, decision })
  return card
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-term-actions-'))
  cwd = join(root, 'demo')
  mkdirSync(cwd)
  core = createCore({ backendId: 'test', backendKind: 'remote', sdk: createFakeSdk(), allowedRoots: [root], coalesceMs: 2 })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd })
  await client.ok('tab.subscribe', { tabId: 't1' })
  terminal = new RawClient(core, 'athome-cli', { deviceId: 'terminal', label: 'terminal', terminal: true })
  await terminal.hello()
})
afterEach(() => core.closeAll())

describe("Claude and its session's terminal", () => {
  it('reads what the terminal shows, as text, without asking', async () => {
    const { terminalId } = await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    await client.ok('terminal.input', { terminalId, data: 'printf "\\033[31mred\\033[0m-%s\\n" ok\r' })
    await expect.poll(read, { timeout: 5000 }).toContain('red-ok')
    expect(await read()).not.toContain('\u001b')
    expect(cards()).toHaveLength(0)
  })

  it('writes after I allow it: with Enter the command runs; without, it waits on the line', async () => {
    const { terminalId } = await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    const run = fromClaude('terminal.write', { text: 'echo cw-"ru"n', enter: true })
    const card = await allow(1)
    expect(card.input).toMatchObject({ action: 'terminal.write', args: { text: 'echo cw-"ru"n', enter: true }, source: 'terminal' })
    expect(card.canAllowAlways).toBe(true)
    expect(await run).toMatchObject({ ok: true, result: { value: { terminalId } } })
    await expect.poll(read, { timeout: 5000 }).toContain('cw-run')
    const typed = fromClaude('terminal.write', { text: 'echo cw-"wa"it' })
    await allow(2)
    await typed
    await expect.poll(read, { timeout: 5000 }).toContain('echo cw-"wa"it')
    expect(await read()).not.toContain('cw-wait')
  })

  it('denied: nothing is written', async () => {
    await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    const run = fromClaude('terminal.write', { text: 'echo cw-"de"nied', enter: true })
    await client.waitFor(() => cards().length === 1)
    await client.ok('request.answer', { tabId: 't1', requestId: cards()[0]!.requestId, decision: 'deny' })
    expect(await run).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await read()).not.toContain('cw-de')
  })

  it('"always in this session": the next writes of this session go without a card', async () => {
    await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    const first = fromClaude('terminal.write', { text: 'echo one', enter: true })
    await allow(1, 'allowAlways')
    await first
    expect(await fromClaude('terminal.write', { text: 'echo cw-"tw"o', enter: true })).toMatchObject({ ok: true })
    await expect.poll(read, { timeout: 5000 }).toContain('cw-two')
    expect(cards()).toHaveLength(1)
  })

  it('no terminal open: the card says so, and once allowed one opens in the session folder', async () => {
    const run = fromClaude('terminal.write', { text: 'pwd', enter: true })
    const card = await allow(1)
    expect(card.input).toMatchObject({ args: { newTerminal: true } })
    const reply = (await run) as { ok: true; result: { value: { terminalId: string } } }
    expect(opened()).toEqual([expect.objectContaining({ terminalId: reply.result.value.terminalId, tabId: 't1', cwd })])
    await expect.poll(read, { timeout: 5000 }).toContain(cwd)
  })

  it("reading with no terminal open says so; nothing but Claude in its session may use it", async () => {
    expect(await fromClaude('terminal.read', {})).toMatchObject({ ok: false, error: { code: 'not_found' } })
    await client.ok('terminal.open', { tabId: 't1', cols: 80, rows: 24 })
    // A program on the server, not in an AtHome session, a person at a terminal without a session, a widget.
    expect(await terminal.cmd('actions.run', { action: 'terminal.read', args: {}, source: 'terminal' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
    expect(await terminal.cmd('actions.run', { action: 'terminal.write', args: { text: 'x' }, source: 'terminal', interactive: true })).toMatchObject({ ok: false, error: { code: 'invalid_args' } })
    expect(await client.cmd('actions.run', { tabId: 't1', action: 'terminal.read', args: {}, source: 'widget' })).toMatchObject({ ok: false, error: { code: 'action_denied' } })
  })
})

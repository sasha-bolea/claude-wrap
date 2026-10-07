// Status / MCP servers / Hooks panels through the protocol, on the fake SDK.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { INSPECT_LIMITS, tabStream, type Item, type TabSnapshot } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'
import { sdk } from './testing/messages.ts'

const CWD = join(mkdtempSync(join(tmpdir(), 'cw-inspect-')), 'demo')
mkdirSync(CWD)
const TAB = tabStream('t1')
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

let fake: FakeSdk
let core: Core
let client: RawClient

// A hook_response message as the CLI sends it with includeHookEvents.
const hookResponse = (name: string, extra: object = {}) =>
  ({ type: 'system', subtype: 'hook_response', hook_id: `h-${name}`, hook_name: name, hook_event: 'PreToolUse', output: '', stdout: '', stderr: '', outcome: 'success', uuid: `u-${name}`, session_id: 's1', ...extra }) as unknown as SDKMessage

// Items of tab t1 as the last snapshot and the following events show them.
function items(): Item[] {
  const reset = client.lastReset(TAB)
  const list = structuredClone((reset?.snapshot as TabSnapshot | undefined)?.items ?? [])
  for (const frame of client.frames.slice(reset ? client.frames.lastIndexOf(reset) + 1 : 0)) {
    if (frame.t === 'ev' && frame.stream === TAB && frame.ev.type === 'item.added') list.push(frame.ev.item)
  }
  return list
}

beforeEach(async () => {
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2 })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd: CWD })
  await client.ok('tab.create', { tabId: 't1', cwd: CWD })
})
afterEach(() => core.closeAll())

describe('a dormant tab', () => {
  it('starts exactly one process and sends no message for each read command', async () => {
    await client.ok('tab.status', { tabId: 't1' })
    expect(fake.sessions).toHaveLength(1)
    await client.ok('tab.mcp', { tabId: 't1' })
    await client.ok('tab.hooks', { tabId: 't1' })
    expect(fake.sessions).toHaveLength(1)
    expect(fake.last().received).toHaveLength(0)
  })
})

describe('status', () => {
  it('normalizes the CLI rows to label/value and lists the settings files', async () => {
    const status = await client.ok('tab.status', { tabId: 't1' })
    expect(status.sections).toEqual([
      { title: 'Session', rows: [{ label: 'Version', value: '2.1.287' }, { label: 'Model', value: 'fake-model' }, { label: 'Cwd', value: '/work' }] },
      { title: 'Empty', rows: [] }
    ])
    expect(status.settingsFiles).toEqual([{ source: 'user', path: '/home/user/.claude/settings.json' }, { source: 'project', path: '/work/.claude/settings.json' }])
  })

  it('falls back to the init message and the account when the CLI has no get_status; other failures are sdk_error', async () => {
    await client.ok('tab.send', { tabId: 't1', text: 'hi' }, '00000000-0000-4000-8000-000000000001')
    const session = fake.last()
    session.emit(sdk.init('s1', { claude_code_version: '2.1.287', cwd: '/work', model: 'haiku' }))
    await tick()
    session.statusAnswer = undefined
    const status = await client.ok('tab.status', { tabId: 't1' })
    expect(status.sections).toEqual([
      { title: 'Session', rows: [{ label: 'Version', value: '2.1.287' }, { label: 'Model', value: 'haiku' }, { label: 'Working directory', value: '/work' }, { label: 'Permission mode', value: 'default' }] },
      { title: 'Account', rows: [{ label: 'Email', value: 'me@example.com' }, { label: 'Plan', value: 'max' }] }
    ])
    session.rejectMethods.set('getStatus', new Error('boom'))
    expect(await client.fails('tab.status', { tabId: 't1' })).toMatchObject({ code: 'sdk_error' })
  })
})

describe('MCP servers', () => {
  it('lists servers with their state, tool count and URL', async () => {
    expect((await client.ok('tab.mcp', { tabId: 't1' })).servers).toEqual([
      { name: 'docs', status: 'connected', scope: 'project', source: 'project', tools: 2, url: 'https://docs.example/mcp' },
      { name: 'broken', status: 'failed', error: 'spawn ENOENT', tools: 0 }
    ])
  })

  it('reconnect, toggle and clear-auth reach the CLI with their arguments, then the servers are read again', async () => {
    await client.ok('tab.mcpReconnect', { tabId: 't1', name: 'docs' })
    await client.ok('tab.mcpToggle', { tabId: 't1', name: 'docs', enabled: false })
    await client.ok('tab.mcpClearAuth', { tabId: 't1', name: 'docs' })
    const calls = fake.last().calls.filter((call) => /Mcp|mcp/.test(call.method))
    expect(calls).toEqual([
      { method: 'reconnectMcpServer', args: ['docs'] },
      { method: 'mcpServerStatus', args: [] },
      { method: 'toggleMcpServer', args: ['docs', false] },
      { method: 'mcpServerStatus', args: [] },
      { method: 'mcpClearAuth', args: ['docs'] },
      { method: 'mcpServerStatus', args: [] }
    ])
  })

  it('sign-in returns the page to open; an address that is not http(s) is refused', async () => {
    expect(await client.ok('tab.mcpAuth', { tabId: 't1', name: 'docs' })).toEqual({ authUrl: 'https://auth.example/authorize?state=x', callbackExpected: true })
    fake.last().authAnswer = { authUrl: 'javascript:alert(1)', callbackExpected: false }
    expect(await client.fails('tab.mcpAuth', { tabId: 't1', name: 'docs' })).toMatchObject({ code: 'invalid_args' })
    fake.last().authAnswer = undefined
    expect(await client.fails('tab.mcpAuth', { tabId: 't1', name: 'docs' })).toMatchObject({ code: 'sdk_error' })
  })

  it('the callback must be an http(s) URL of at most 4096 characters', async () => {
    await client.ok('tab.mcpAuthCallback', { tabId: 't1', name: 'docs', url: 'http://localhost:3118/cb?code=abc' })
    expect(fake.last().calls.at(-2)).toEqual({ method: 'mcpSubmitOAuthCallbackUrl', args: ['docs', 'http://localhost:3118/cb?code=abc'] })
    expect(await client.fails('tab.mcpAuthCallback', { tabId: 't1', name: 'docs', url: 'file:///etc/passwd' })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('tab.mcpAuthCallback', { tabId: 't1', name: 'docs', url: 'https://x.example/' + 'a'.repeat(5000) })).toMatchObject({ code: 'invalid_args' })
  })

  it('SDK failures become sdk_error', async () => {
    await client.ok('tab.mcp', { tabId: 't1' })
    const session = fake.last()
    for (const [method, command, args] of [
      ['mcpServerStatus', 'tab.mcp', {}],
      ['reconnectMcpServer', 'tab.mcpReconnect', { name: 'docs' }],
      ['toggleMcpServer', 'tab.mcpToggle', { name: 'docs', enabled: true }],
      ['mcpClearAuth', 'tab.mcpClearAuth', { name: 'docs' }]
    ] as const) {
      session.rejectMethods.set(method, new Error('nope'))
      expect(await client.fails(command, { tabId: 't1', ...args }), method).toMatchObject({ code: 'sdk_error' })
    }
  })
})

describe('hooks', () => {
  it('maps the listing: matcher and optional fields only when present, policy flags', async () => {
    const { listing, runs } = await client.ok('tab.hooks', { tabId: 't1' })
    expect(listing).toEqual({
      hooks: [{ event: 'PreToolUse', matcher: 'Bash', source: 'userSettings', sourceLabel: 'User settings', type: 'command', commandText: 'npm run lint', timeout: 30 }],
      policy: { allDisabled: false, managedOnly: false, disabledByPolicy: false, pluginOnly: false }
    })
    expect(runs).toEqual([])
    fake.last().rejectMethods.set('getHooksListing', new Error('nope'))
    expect(await client.fails('tab.hooks', { tabId: 't1' })).toMatchObject({ code: 'sdk_error' })
  })

  it('hook_response messages become runs (newest last, at most 50, output capped) and no transcript items', async () => {
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'hi' }, '00000000-0000-4000-8000-000000000001')
    const session = fake.last()
    await session.waitForInput(1)
    const before = items().length
    session.emit({ type: 'system', subtype: 'hook_started', hook_id: 'x', hook_name: 'x', hook_event: 'PreToolUse', uuid: 'hs', session_id: 's1' } as unknown as SDKMessage)
    session.emit({ type: 'system', subtype: 'hook_progress', hook_id: 'x', hook_name: 'x', hook_event: 'PreToolUse', stdout: 'a', stderr: '', output: 'a', uuid: 'hp', session_id: 's1' } as unknown as SDKMessage)
    for (let i = 0; i < 55; i++) session.emit(hookResponse(`hook-${i}`, i === 54 ? { stdout: 'o'.repeat(5000), stderr: 'bad', exit_code: 2, outcome: 'error' } : {}))
    await tick(50)
    const { runs } = await client.ok('tab.hooks', { tabId: 't1' })
    expect(runs).toHaveLength(INSPECT_LIMITS.hooks)
    expect(runs[0]?.name).toBe('hook-5')
    expect(runs.at(-1)).toMatchObject({ name: 'hook-54', event: 'PreToolUse', outcome: 'error', exitCode: 2, stderr: 'bad' })
    expect(runs.at(-1)?.stdout).toHaveLength(INSPECT_LIMITS.output)
    expect(items()).toHaveLength(before)
  })

  it('asks the CLI for hook events', async () => {
    await client.ok('tab.status', { tabId: 't1' })
    expect(fake.last().options.includeHookEvents).toBe(true)
  })
})

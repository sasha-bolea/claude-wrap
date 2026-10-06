// Claude's use of the shared browser. User stories: a session on the server gets the Playwright MCP attached to
// the same Chromium Sasha watches; while a browser tool runs, the chat shows as acting in the live view; overlapping
// calls keep it so until all end; ending the session clears it; without a browser nothing changes.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browserStream, type BrowserEvent } from '@athome/protocol'
import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeCdp } from './testing/fakeCdp.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

const MCP = { command: '/usr/bin/node', args: ['/x/cli.js', '--headless', '--cdp-endpoint', 'http://127.0.0.1:3013'] }
let core: Core | undefined
let client: RawClient | undefined
let launched = 0

// A core on the fake SDK with a tab 't1' ("Chat") and a trusted folder; mcp: the browser's MCP command.
async function setup(withBrowser: boolean, withMcp = true) {
  const sdk: FakeSdk = createFakeSdk()
  const cwd = join(mkdtempSync(join(tmpdir(), 'cw-bmcp-')), 'p')
  mkdirSync(cwd)
  const browser: CoreConfig['browser'] = withBrowser
    ? {
        port: 3013, executable: '/fake/chrome', profileDir: '/fake/profile', ...(withMcp ? { mcp: MCP } : {}),
        launch: () => (launched++, { kill: () => {}, exited: new Promise<void>(() => {}) }),
        connect: async () => createFakeCdp().transport
      }
    : undefined
  core = createCore({ backendId: 'test', backendKind: 'remote', sdk, coalesceMs: 2, browser })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd, title: 'Chat' })
  await client.ok('tab.send', { tabId: 't1', text: 'hi' })
  return { sdk, client }
}

const hooksOf = (sdk: FakeSdk, event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure') => sdk.sessions[0]!.options.hooks?.[event] ?? []
// Runs the callbacks of a hook event as the CLI does for a browser tool.
async function fire(sdk: FakeSdk, event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure') {
  for (const matcher of hooksOf(sdk, event)) for (const hook of matcher.hooks as HookCallback[]) await hook({ hook_event_name: event } as HookInput, 'tu1', { signal: new AbortController().signal })
}
const acting = (of: RawClient) => (of.events(browserStream()).filter((ev) => ev.type === 'browser.acting') as Extract<BrowserEvent, { type: 'browser.acting' }>[]).map((ev) => ev.sessions.map((s) => s.title))

afterEach(async () => {
  client?.close()
  await core?.closeAll()
  core = client = undefined
  launched = 0
})

describe('session options', () => {
  it('a workspace with a browser and MCP gives the session the playwright server and the hooks', async () => {
    const { sdk } = await setup(true)
    const options = sdk.sessions[0]!.options
    expect(options.mcpServers?.playwright).toEqual({ type: 'stdio', command: MCP.command, args: MCP.args })
    expect(hooksOf(sdk, 'PreToolUse')[0]!.matcher).toBe('^mcp__playwright__')
    expect(hooksOf(sdk, 'PostToolUse')[0]!.matcher).toBe('^mcp__playwright__')
    expect(hooksOf(sdk, 'PostToolUseFailure')[0]!.matcher).toBe('^mcp__playwright__')
  })

  it('without a browser, or a browser without MCP, nothing is added', async () => {
    const { sdk } = await setup(false)
    expect(sdk.sessions[0]!.options.mcpServers).toBeUndefined()
    expect(sdk.sessions[0]!.options.hooks).toBeUndefined()
    await core!.closeAll()
    const second = await setup(true, false)
    expect(second.sdk.sessions[0]!.options.mcpServers).toBeUndefined()
    expect(second.sdk.sessions[0]!.options.hooks).toBeUndefined()
  })
})

describe('acting', () => {
  it('PreToolUse starts the browser and lists the chat; PostToolUse removes it', async () => {
    const { sdk, client } = await setup(true)
    await client.ok('browser.subscribe', {})
    await fire(sdk, 'PreToolUse')
    expect(launched).toBe(1)
    await client.waitFor(() => acting(client).length === 1)
    expect(acting(client)).toEqual([['Chat']])
    await fire(sdk, 'PostToolUse')
    await client.waitFor(() => acting(client).length === 2)
    expect(acting(client).at(-1)).toEqual([])
  })

  it('overlapping calls keep the chat acting until both end (a failure ends one too)', async () => {
    const { sdk, client } = await setup(true)
    await client.ok('browser.subscribe', {})
    await fire(sdk, 'PreToolUse')
    await fire(sdk, 'PreToolUse')
    await fire(sdk, 'PostToolUse')
    expect(acting(client)).toEqual([['Chat']])
    await fire(sdk, 'PostToolUseFailure')
    await client.waitFor(() => acting(client).length === 2)
    expect(acting(client).at(-1)).toEqual([])
  })

  it('closing the session clears it', async () => {
    const { sdk, client } = await setup(true)
    await client.ok('browser.subscribe', {})
    await fire(sdk, 'PreToolUse')
    await client.ok('tab.close', { tabId: 't1' })
    await client.waitFor(() => acting(client).at(-1)?.length === 0)
    expect(acting(client)).toEqual([['Chat'], []])
  })
})

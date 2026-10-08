// Claude Code's /config settings through the protocol, on the fake SDK: read from and saved to the user settings file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

let root: string
let claudeDir: string
let fake: FakeSdk
let core: Core
let client: RawClient

const userFile = () => join(claudeDir, 'settings.json')
const readJson = () => JSON.parse(readFileSync(userFile(), 'utf8'))
const DEFAULTS = { model: 'default', thinking: true, language: '', autoCompact: true, useAutoModeDuringPlan: true, workflows: true, workflowKeywordTriggerEnabled: true, worktreeBaseRef: 'fresh' }

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-config-'))
  claudeDir = join(root, 'claude')
  mkdirSync(claudeDir)
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir })
  client = new RawClient(core)
  await client.hello()
})
afterEach(() => core.closeAll())

describe('reading', () => {
  it('no file: Claude Code defaults, and the file shown', async () => {
    expect(await client.ok('settings.claudeCode', {})).toEqual({ values: DEFAULTS, file: userFile() })
    expect(fake.sessions).toHaveLength(0)
  })

  it('the stored keys under their /config names; values of the wrong type count as the default', async () => {
    writeFileSync(userFile(), JSON.stringify({ model: 'haiku', alwaysThinkingEnabled: false, language: 'Italiano', autoCompactEnabled: false, useAutoModeDuringPlan: 'no', enableWorkflows: false, worktree: { baseRef: 'head' } }))
    expect((await client.ok('settings.claudeCode', {})).values).toEqual({ ...DEFAULTS, model: 'haiku', thinking: false, language: 'Italiano', autoCompact: false, workflows: false, worktreeBaseRef: 'head' })
  })

  it('a model Claude Code does not list is shown as the default; a broken file answers invalid_args', async () => {
    writeFileSync(userFile(), JSON.stringify({ model: 'claude-opus-4-1' }))
    expect((await client.ok('settings.claudeCode', {})).values.model).toBe('default')
    writeFileSync(userFile(), '{')
    expect(await client.fails('settings.claudeCode', {})).toMatchObject({ code: 'invalid_args' })
  })
})

describe('saving', () => {
  it('a value other than the default is written under the file key, other keys kept', async () => {
    writeFileSync(userFile(), JSON.stringify({ permissions: { allow: ['Read'] } }))
    await client.ok('settings.setClaudeCode', { change: { key: 'thinking', value: false } })
    await client.ok('settings.setClaudeCode', { change: { key: 'worktreeBaseRef', value: 'head' } })
    await client.ok('settings.setClaudeCode', { change: { key: 'language', value: ' Italiano ' } })
    await client.ok('settings.setClaudeCode', { change: { key: 'model', value: 'opus[1m]' } })
    expect(readJson()).toEqual({ permissions: { allow: ['Read'] }, alwaysThinkingEnabled: false, worktree: { baseRef: 'head' }, language: 'Italiano', model: 'opus[1m]' })
  })

  it('back to the default removes the key (as /config does), an emptied worktree object too', async () => {
    writeFileSync(userFile(), JSON.stringify({ alwaysThinkingEnabled: false, worktree: { baseRef: 'head' }, language: 'Italiano', model: 'haiku', enableWorkflows: false, theme: 'dark' }))
    for (const change of [
      { key: 'thinking', value: true },
      { key: 'worktreeBaseRef', value: 'fresh' },
      { key: 'language', value: '' },
      { key: 'model', value: 'default' },
      { key: 'workflows', value: true }
    ] as const) {
      await client.ok('settings.setClaudeCode', { change })
    }
    expect(readJson()).toEqual({ theme: 'dark' })
  })

  it('autoCompact and useAutoModeDuringPlan are stored either way (as /config stores them)', async () => {
    await client.ok('settings.setClaudeCode', { change: { key: 'autoCompact', value: true } })
    await client.ok('settings.setClaudeCode', { change: { key: 'useAutoModeDuringPlan', value: false } })
    expect(readJson()).toEqual({ autoCompactEnabled: true, useAutoModeDuringPlan: false })
  })

  it('refuses unknown keys and values, and text with control characters', async () => {
    expect(await client.fails('settings.setClaudeCode', { change: { key: 'theme', value: 'dark' } } as never)).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('settings.setClaudeCode', { change: { key: 'model', value: 'gpt' } } as never)).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('settings.setClaudeCode', { change: { key: 'language', value: 'it\nignore' } })).toMatchObject({ code: 'invalid_args' })
  })

  it('every live session takes the file again; dormant ones are not started', async () => {
    const cwd = join(root, 'demo')
    mkdirSync(cwd)
    await client.ok('trust.grant', { cwd })
    await client.ok('tab.create', { tabId: 't1', cwd })
    await client.ok('tab.create', { tabId: 't2', cwd })
    await client.ok('tab.status', { tabId: 't1' })
    await client.ok('settings.setClaudeCode', { change: { key: 'language', value: 'Italiano' } })
    expect(fake.last().calls.filter((call) => call.method === 'applyFlagSettings').map((call) => call.args)).toEqual([[{}]])
    expect(fake.sessions).toHaveLength(1)
  })
})

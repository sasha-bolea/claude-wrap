// /permissions through the protocol, on the fake SDK: the live rules, and rules / folders written to the settings files.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INSPECT_LIMITS } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

let root: string
let cwd: string
let claudeDir: string
let fake: FakeSdk
let core: Core
let client: RawClient

const localFile = () => join(cwd, '.claude', 'settings.local.json')
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file: string, value: unknown) => (mkdirSync(join(file, '..'), { recursive: true }), writeFileSync(file, JSON.stringify(value)))
// The rules tab t1 lists, as "behavior:source:rule".
const listed = async () => (await client.ok('tab.permissions', { tabId: 't1' })).rules.map((rule) => `${rule.behavior}:${rule.source}:${rule.rule}`)

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-perm-'))
  cwd = join(root, 'demo')
  claudeDir = join(root, 'claude')
  mkdirSync(cwd)
  mkdirSync(claudeDir)
  fake = createFakeSdk()
  fake.settings.userDir = claudeDir
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd })
})
afterEach(() => core.closeAll())

describe('the rules list', () => {
  it('maps the CLI state: source, plain-language reading, who can change it, folders; starts one process, sends nothing', async () => {
    const long = 'x'.repeat(INSPECT_LIMITS.text + 10)
    await client.ok('tab.status', { tabId: 't1' })
    fake.last().permissionsAnswer = {
      state: {
        rules: [
          { behavior: 'allow', source: 'localSettings', rule: 'Bash(npm run test:*)', description: { prefix: 'Any Bash command starting with ', emphasis: 'npm run test' }, editability: 'persistent' },
          { behavior: 'deny', source: 'policySettings', rule: long, editability: 'readonly', notInEffect: true },
          { behavior: 'ask', source: 'session', rule: 'WebFetch', editability: 'session' },
          { behavior: 'maybe', source: 'x', rule: 'Odd', editability: 'persistent' }
        ],
        workspaceDirectories: [{ path: '/extra', source: 'cliArg' }],
        originalCwd: cwd,
        managedOnly: false
      }
    }
    const permissions = await client.ok('tab.permissions', { tabId: 't1' })
    expect(permissions.rules).toEqual([
      { behavior: 'allow', source: 'localSettings', rule: 'Bash(npm run test:*)', description: { prefix: 'Any Bash command starting with ', emphasis: 'npm run test' }, editable: 'persistent' },
      { behavior: 'deny', source: 'policySettings', rule: long.slice(0, INSPECT_LIMITS.text), editable: 'readonly', notInEffect: true },
      { behavior: 'ask', source: 'session', rule: 'WebFetch', editable: 'session' }
    ])
    expect(permissions.directories).toEqual([{ path: '/extra', source: 'cliArg' }])
    expect(permissions).toMatchObject({ cwd, managedOnly: false })
    expect(fake.sessions).toHaveLength(1)
    expect(fake.last().received).toHaveLength(0)
  })

  it('a CLI without the request, or one that fails, answers sdk_error', async () => {
    await client.ok('tab.status', { tabId: 't1' })
    fake.last().rejectMethods.set('listPermissionRules', new Error('nope'))
    expect(await client.fails('tab.permissions', { tabId: 't1' })).toMatchObject({ code: 'sdk_error' })
  })
})

describe('adding and removing a rule', () => {
  it('local: written to .claude/settings.local.json, other keys kept, the live session takes it at once', async () => {
    writeJson(localFile(), { outputStyle: 'Concise', permissions: { allow: ['Read'], defaultMode: 'default' } })
    expect(await listed()).toEqual(['allow:localSettings:Read'])
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'deny', rule: ' Bash(rm -rf:*) ', destination: 'localSettings' })
    expect(readJson(localFile())).toEqual({ outputStyle: 'Concise', permissions: { allow: ['Read'], defaultMode: 'default', deny: ['Bash(rm -rf:*)'] } })
    expect(await listed()).toEqual(['allow:localSettings:Read', 'deny:localSettings:Bash(rm -rf:*)'])
    expect(fake.sessions).toHaveLength(1)
  })

  it('project and user: .claude/settings.json of the folder, settings.json of the Claude config folder', async () => {
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'ask', rule: 'Bash(git push:*)', destination: 'projectSettings' })
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'mcp__docs__*', destination: 'userSettings' })
    expect(readJson(join(cwd, '.claude', 'settings.json'))).toEqual({ permissions: { ask: ['Bash(git push:*)'] } })
    expect(readJson(join(claudeDir, 'settings.json'))).toEqual({ permissions: { allow: ['mcp__docs__*'] } })
    expect(await listed()).toEqual(['allow:userSettings:mcp__docs__*', 'ask:projectSettings:Bash(git push:*)'])
  })

  it('a rule already there changes nothing; removing takes the exact text out; removing a missing rule is not_found', async () => {
    writeJson(localFile(), { permissions: { allow: ['Read', 'Bash(ls)'] } })
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'Read', destination: 'localSettings' })
    expect(readJson(localFile()).permissions.allow).toEqual(['Read', 'Bash(ls)'])
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'remove', behavior: 'allow', rule: 'Read', destination: 'localSettings' })
    expect(readJson(localFile()).permissions.allow).toEqual(['Bash(ls)'])
    expect(await client.fails('tab.permissionRule', { tabId: 't1', op: 'remove', behavior: 'deny', rule: 'Bash(ls)', destination: 'localSettings' })).toMatchObject({ code: 'not_found' })
  })

  it('refuses text that is not a rule, and a settings file that is not valid JSON (left untouched)', async () => {
    for (const rule of ['Bash(ls)\nRead', '(ls)', 'Bash ls', '9Tool']) {
      expect(await client.fails('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule, destination: 'localSettings' }), rule).toMatchObject({ code: 'invalid_args' })
    }
    mkdirSync(join(cwd, '.claude'), { recursive: true })
    writeFileSync(localFile(), '{ "permissions": ')
    expect(await client.fails('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'Read', destination: 'localSettings' })).toMatchObject({ code: 'invalid_args' })
    writeJson(join(cwd, '.claude', 'settings.json'), { permissions: { allow: 'Read' } })
    expect(await client.fails('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'Edit', destination: 'projectSettings' })).toMatchObject({ code: 'invalid_args' })
    expect(readFileSync(localFile(), 'utf8')).toBe('{ "permissions": ')
  })

  it('writes through a symlinked settings file (configuration kept in git stays linked)', async () => {
    const real = join(root, 'config-repo', 'settings.json')
    writeJson(real, { theme: 'dark' })
    symlinkSync(real, join(claudeDir, 'settings.json'))
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'Read', destination: 'userSettings' })
    expect(lstatSync(join(claudeDir, 'settings.json')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(claudeDir, 'settings.json'))).toBe(real)
    expect(readJson(real)).toEqual({ theme: 'dark', permissions: { allow: ['Read'] } })
  })

  it('every live session takes the files again; dormant ones are not started', async () => {
    const other = join(root, 'other')
    mkdirSync(other)
    await client.ok('trust.grant', { cwd: other })
    await client.ok('tab.create', { tabId: 't2', cwd: other })
    await client.ok('tab.create', { tabId: 't3', cwd: other })
    await client.ok('tab.permissions', { tabId: 't2' })
    const t2 = fake.last()
    await client.ok('tab.permissionRule', { tabId: 't1', op: 'add', behavior: 'allow', rule: 'Read', destination: 'userSettings' })
    expect(t2.calls.filter((call) => call.method === 'applyFlagSettings').map((call) => call.args)).toEqual([[{}]])
    expect(fake.sessions).toHaveLength(2)
    expect((await client.ok('tab.permissions', { tabId: 't2' })).rules.map((rule) => rule.rule)).toEqual(['Read'])
  })

  it('an untrusted folder is refused before any file is written', async () => {
    const untrusted = join(root, 'untrusted')
    mkdirSync(untrusted)
    await client.ok('tab.create', { tabId: 't4', cwd: untrusted })
    expect(await client.fails('tab.permissionRule', { tabId: 't4', op: 'add', behavior: 'allow', rule: 'Read', destination: 'localSettings' })).toMatchObject({ code: 'needs_trust' })
    expect(() => readFileSync(join(untrusted, '.claude', 'settings.local.json'))).toThrow()
  })
})

describe('extra working folders', () => {
  it('add: a folder relative to the session folder or with ~ is stored absolute; a missing one is not_found', async () => {
    mkdirSync(join(root, 'shared'))
    await client.ok('tab.permissionDirectory', { tabId: 't1', op: 'add', path: '../shared', destination: 'localSettings' })
    expect(readJson(localFile()).permissions.additionalDirectories).toEqual([join(root, 'shared')])
    expect((await client.ok('tab.permissions', { tabId: 't1' })).directories).toEqual([{ path: join(root, 'shared'), source: 'localSettings' }])
    expect(await client.fails('tab.permissionDirectory', { tabId: 't1', op: 'add', path: join(root, 'nope'), destination: 'localSettings' })).toMatchObject({ code: 'not_found' })
  })

  it('remove: looked for in the given file first, then in the other settings files', async () => {
    writeJson(join(cwd, '.claude', 'settings.json'), { permissions: { additionalDirectories: ['/a', '/b'] } })
    await client.ok('tab.permissionDirectory', { tabId: 't1', op: 'remove', path: '/b', destination: 'localSettings' })
    expect(readJson(join(cwd, '.claude', 'settings.json')).permissions.additionalDirectories).toEqual(['/a'])
    expect(await client.fails('tab.permissionDirectory', { tabId: 't1', op: 'remove', path: '/c', destination: 'projectSettings' })).toMatchObject({ code: 'not_found' })
  })
})

// /memory through the protocol, on the fake SDK: the files the CLI lists, reading and writing them, deleting saved
// memories, the auto-memory switch.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore, type Core } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'

let root: string
let cwd: string
let claudeDir: string
let memoryDir: string
let trashed: string[]
let fake: FakeSdk
let core: Core
let client: RawClient

const userFile = () => join(claudeDir, 'CLAUDE.md')
const projectFile = () => join(cwd, 'CLAUDE.md')
const memoryFile = (name: string) => join(memoryDir, name)

// The dialog the fake CLI answers: user and project instruction files (the project one not created yet), one memory
// and the index.
function dialog() {
  return {
    files: [
      { kind: 'user', path: userFile(), label: 'User instructions', description: 'Saved in ~/.claude/CLAUDE.md', exists: true },
      { kind: 'project', path: projectFile(), label: 'Project instructions', description: 'Checked in at ./CLAUDE.md', exists: false }
    ],
    folders: [{ kind: 'auto', path: `${memoryDir}/`, label: 'Open auto-memory folder', description: '' }],
    memories: [
      { name: 'MEMORY.md', path: memoryFile('MEMORY.md'), description: 'Index of saved memories', type: null, modified_ms: 1000.5 },
      { name: 'tabs.md', path: memoryFile('tabs.md'), description: 'Prefers tabs', type: 'feedback', modified_ms: 2000 }
    ]
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-memory-'))
  cwd = join(root, 'demo')
  claudeDir = join(root, 'claude')
  memoryDir = join(claudeDir, 'projects', 'demo', 'memory')
  mkdirSync(cwd)
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(userFile(), '# Mine\n')
  writeFileSync(memoryFile('MEMORY.md'), '- [Tabs](tabs.md) — prefers tabs\n- [Other](other.md) — other\n')
  writeFileSync(memoryFile('tabs.md'), '---\nname: tabs\n---\nTabs.\n')
  trashed = []
  fake = createFakeSdk()
  fake.settings.userDir = claudeDir
  const trashItem = async (path: string) => (trashed.push(path), rmSync(path))
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir, trashItem })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd })
  await client.ok('tab.create', { tabId: 't1', cwd })
  await client.ok('tab.status', { tabId: 't1' })
  fake.last().memoryDialog = dialog()
})
afterEach(() => core.closeAll())

describe('the memory list', () => {
  it('maps the CLI dialog: files (also ones not created yet), the auto-memory folder, memories; auto memory on by default', async () => {
    expect(await client.ok('tab.memory', { tabId: 't1' })).toEqual({
      files: [
        { kind: 'user', path: userFile(), label: 'User instructions', description: 'Saved in ~/.claude/CLAUDE.md', exists: true },
        { kind: 'project', path: projectFile(), label: 'Project instructions', description: 'Checked in at ./CLAUDE.md', exists: false }
      ],
      folder: `${memoryDir}/`,
      memories: [
        { name: 'MEMORY.md', path: memoryFile('MEMORY.md'), description: 'Index of saved memories', modifiedAt: 1000.5 },
        { name: 'tabs.md', path: memoryFile('tabs.md'), description: 'Prefers tabs', type: 'feedback', modifiedAt: 2000 }
      ],
      autoMemory: true
    })
    expect(fake.last().received).toHaveLength(0)
  })

  it('a CLI without the request answers sdk_error', async () => {
    fake.last().memoryDialog = undefined
    expect(await client.fails('tab.memory', { tabId: 't1' })).toMatchObject({ code: 'sdk_error' })
  })
})

describe('reading and writing', () => {
  it('reads a listed file with its version; a file not created yet is empty with version ""', async () => {
    const user = await client.ok('tab.memoryRead', { tabId: 't1', path: userFile() })
    expect(user).toMatchObject({ text: '# Mine\n', exists: true })
    expect(user.version).not.toBe('')
    expect(await client.ok('tab.memoryRead', { tabId: 't1', path: projectFile() })).toEqual({ text: '', exists: false, version: '' })
    expect((await client.ok('tab.memoryRead', { tabId: 't1', path: memoryFile('tabs.md') })).text).toContain('Tabs.')
  })

  it('refuses any path the CLI does not list (outside_root), also through ..', async () => {
    writeFileSync(join(root, 'secret.txt'), 'x')
    for (const path of [join(root, 'secret.txt'), `${memoryDir}/../../../../secret.txt`, join(claudeDir, 'settings.json')]) {
      expect(await client.fails('tab.memoryRead', { tabId: 't1', path }), path).toMatchObject({ code: 'outside_root' })
      expect(await client.fails('tab.memoryWrite', { tabId: 't1', path, text: 'x', version: '' }), path).toMatchObject({ code: 'outside_root' })
    }
  })

  it('writes an instruction file at its version, creates one not there yet, refuses one changed meanwhile', async () => {
    const { version } = await client.ok('tab.memoryRead', { tabId: 't1', path: userFile() })
    const saved = await client.ok('tab.memoryWrite', { tabId: 't1', path: userFile(), text: '# Mine\nMore.\n', version })
    expect(readFileSync(userFile(), 'utf8')).toBe('# Mine\nMore.\n')
    expect(saved.version).not.toBe(version)
    expect(await client.fails('tab.memoryWrite', { tabId: 't1', path: userFile(), text: 'stale', version })).toMatchObject({ code: 'invalid_args' })
    expect(readFileSync(userFile(), 'utf8')).toBe('# Mine\nMore.\n')
    await client.ok('tab.memoryWrite', { tabId: 't1', path: projectFile(), text: '# Project\n', version: '' })
    expect(readFileSync(projectFile(), 'utf8')).toBe('# Project\n')
    expect(await client.fails('tab.memoryWrite', { tabId: 't1', path: projectFile(), text: 'again', version: '' })).toMatchObject({ code: 'invalid_args' })
  })

  it('memories are not written from the app', async () => {
    const { version } = await client.ok('tab.memoryRead', { tabId: 't1', path: memoryFile('tabs.md') })
    expect(await client.fails('tab.memoryWrite', { tabId: 't1', path: memoryFile('tabs.md'), text: 'x', version })).toMatchObject({ code: 'invalid_args' })
  })

  it('writes through a symlinked instruction file (configuration kept in git stays linked)', async () => {
    const real = join(root, 'config-repo', 'CLAUDE.md')
    mkdirSync(join(root, 'config-repo'))
    writeFileSync(real, 'linked\n')
    rmSync(userFile())
    symlinkSync(real, userFile())
    const { version } = await client.ok('tab.memoryRead', { tabId: 't1', path: userFile() })
    await client.ok('tab.memoryWrite', { tabId: 't1', path: userFile(), text: 'linked, edited\n', version })
    expect(lstatSync(userFile()).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('linked, edited\n')
  })
})

describe('deleting a memory', () => {
  it('moves it to the trash and takes its line out of MEMORY.md', async () => {
    await client.ok('tab.memoryDelete', { tabId: 't1', path: memoryFile('tabs.md') })
    expect(trashed).toEqual([memoryFile('tabs.md')])
    expect(existsSync(memoryFile('tabs.md'))).toBe(false)
    expect(readFileSync(memoryFile('MEMORY.md'), 'utf8')).toBe('- [Other](other.md) — other\n')
  })

  it('the index itself, instruction files and unlisted paths cannot be deleted', async () => {
    expect(await client.fails('tab.memoryDelete', { tabId: 't1', path: memoryFile('MEMORY.md') })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('tab.memoryDelete', { tabId: 't1', path: userFile() })).toMatchObject({ code: 'invalid_args' })
    expect(await client.fails('tab.memoryDelete', { tabId: 't1', path: join(root, 'x.md') })).toMatchObject({ code: 'outside_root' })
    expect(trashed).toEqual([])
  })
})

describe('auto memory', () => {
  it('off: saved in the user settings and taken by the live session; on again', async () => {
    await client.ok('tab.setAutoMemory', { tabId: 't1', enabled: false })
    expect(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'))).toEqual({ autoMemoryEnabled: false })
    expect((await client.ok('tab.memory', { tabId: 't1' })).autoMemory).toBe(false)
    await client.ok('tab.setAutoMemory', { tabId: 't1', enabled: true })
    expect((await client.ok('tab.memory', { tabId: 't1' })).autoMemory).toBe(true)
  })
})

// A folder renamed or moved outside the app (mv by Claude, a person, another program): core finds it again by its
// identity (device + inode) and its sessions follow it — open ones, their stored conversations, the folder's past
// sessions and Claude's memory of it, its subfolders' history, notes, project mark and trust.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { projectDirName } from './relocate.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { sdk } from './testing/messages.ts'
import { RawClient } from './testing/rawClient.ts'

const OPEN = '11111111-0000-0000-0000-000000000001'
const PAST = '11111111-0000-0000-0000-000000000002'
const INSIDE = '11111111-0000-0000-0000-000000000003'
const SIBLING = '11111111-0000-0000-0000-000000000004'

let root: string
let from: string
let to: string
let claudeDir: string
let fake: FakeSdk
let core: Core
let client: RawClient

const history = (folder: string) => join(claudeDir, 'projects', projectDirName(folder))
// Stores a conversation as the CLI does: <history of folder>/<id>.jsonl, the folder as the cwd of its lines.
function store(folder: string, sessionId: string): void {
  mkdirSync(history(folder), { recursive: true })
  writeFileSync(join(history(folder), `${sessionId}.jsonl`), JSON.stringify({ type: 'user', cwd: folder, sessionId }) + '\n')
}
const cwdIn = (folder: string, sessionId: string) => (JSON.parse(readFileSync(join(history(folder), `${sessionId}.jsonl`), 'utf8')) as { cwd: string }).cwd
// A tab's metadata as the workspace stream last told it.
function meta(tabId = 't1'): { cwd: string; title: string } | undefined {
  const events = client.events(WORKSPACE_STREAM) as { tab?: { tabId: string; cwd: string; title: string } }[]
  return events.flatMap((event) => (event.tab?.tabId === tabId ? [event.tab] : [])).at(-1)
}
// The project marks as the workspace stream last told them.
function projects(): string[] | undefined {
  const events = client.events(WORKSPACE_STREAM) as { type: string; projects?: string[] }[]
  return events.filter((event) => event.type === 'folders.updated').at(-1)?.projects
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-follow-')))
  from = join(root, 'server-management')
  to = join(root, 'cruscotto')
  claudeDir = join(root, 'claude')
  mkdirSync(join(from, 'sub'), { recursive: true })
  mkdirSync(join(root, 'server-management-old'))
  store(from, OPEN)
  store(from, PAST)
  store(join(from, 'sub'), INSIDE)
  store(join(root, 'server-management-old'), SIBLING)
  mkdirSync(join(history(from), 'memory'))
  writeFileSync(join(history(from), 'memory', 'MEMORY.md'), '- [Tabs](tabs.md)\n')
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir, allowedRoots: [root], folderCheckMs: 20 })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd: from })
  await client.ok('folders.setProject', { path: from, project: true })
  await client.ok('notes.save', { cwd: from, text: 'remember the port' })
  await client.ok('tab.create', { tabId: 't1', cwd: from, resume: OPEN })
})
afterEach(() => core.closeAll())

describe('a folder renamed outside the app', () => {
  it('the open session follows it by itself: new folder, conversation moved, the chat says so', async () => {
    await client.ok('tab.subscribe', { tabId: 't1' })
    renameSync(from, to)
    await client.waitFor(() => meta()?.cwd === to)
    expect(meta()?.title).toBe('cruscotto')
    expect(cwdIn(to, OPEN)).toBe(to)
    expect(existsSync(join(history(from), `${OPEN}.jsonl`))).toBe(false)
    await client.waitFor(() => JSON.stringify(client.frames).includes(`The folder moved to ${to}`))
    // Trusted already: the next message starts the session there, on the same conversation.
    await client.ok('tab.send', { tabId: 't1', text: 'go on' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 1)
    expect(fake.last().options).toMatchObject({ cwd: to, resume: OPEN })
  })

  it("the folder's past sessions, Claude's memory of it and its subfolders' history move; a sibling with a similar name does not", async () => {
    renameSync(from, to)
    await client.waitFor(() => meta()?.cwd === to)
    expect(cwdIn(to, PAST)).toBe(to)
    expect(readFileSync(join(history(to), 'memory', 'MEMORY.md'), 'utf8')).toContain('Tabs')
    expect(cwdIn(join(to, 'sub'), INSIDE)).toBe(join(to, 'sub'))
    expect(cwdIn(join(root, 'server-management-old'), SIBLING)).toBe(join(root, 'server-management-old'))
    expect(existsSync(history(from))).toBe(false)
  })

  it('its notes and its project mark go with it', async () => {
    renameSync(from, to)
    await client.waitFor(() => meta()?.cwd === to)
    expect(projects()).toEqual([to])
    expect((await client.ok('notes.list', { cwd: to })).notes.map((note) => note.text)).toEqual(['remember the port'])
  })

  it('found when a message is sent, even before the regular check', async () => {
    await core.closeAll()
    core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir, allowedRoots: [root], folderCheckMs: 60_000 })
    client = new RawClient(core)
    await client.hello()
    await client.ok('trust.grant', { cwd: from })
    await client.ok('tab.create', { tabId: 't2', cwd: from, resume: OPEN })
    renameSync(from, to)
    await client.ok('tab.send', { tabId: 't2', text: 'hi' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 1)
    expect(fake.last().options).toMatchObject({ cwd: to, resume: OPEN })
    expect(cwdIn(to, OPEN)).toBe(to)
  })

  it('moved into another folder of the Home, deeper down: found there too', async () => {
    mkdirSync(join(root, 'archive', '2026'), { recursive: true })
    const deeper = join(root, 'archive', '2026', 'server-management')
    renameSync(from, deeper)
    await client.waitFor(() => meta()?.cwd === deeper)
    expect(cwdIn(deeper, OPEN)).toBe(deeper)
  })

  it('a session at work moves at the end of its turn', async () => {
    await client.ok('tab.send', { tabId: 't1', text: 'work' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 1)
    const session = fake.last()
    session.emit(sdk.init(OPEN))
    renameSync(from, to)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(meta()?.cwd).toBe(from)
    expect(session.closed).toBe(false)
    session.emit(sdk.success())
    await client.waitFor(() => meta()?.cwd === to)
    expect(session.closed).toBe(true)
    expect(cwdIn(to, OPEN)).toBe(to)
  })

  it('a folder deleted is not followed: its session and history stay as they were', async () => {
    rmSync(from, { recursive: true })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(meta()?.cwd).toBe(from)
    expect(cwdIn(from, OPEN)).toBe(from)
    expect((await client.fails('tab.send', { tabId: 't1', text: 'hi' })).code).toBe('not_found')
  })
})

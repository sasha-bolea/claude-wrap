// Moving a session to another folder (tab.move) through the protocol, on the fake SDK: its stored conversation follows
// it into the new folder's history (the cwd recorded in it rewritten), the process restarts there on the same
// conversation; at work, at the end of the turn.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM } from '@athome/protocol'
import { createCore, type Core } from './core.ts'
import { projectDirName } from './relocate.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { sdk } from './testing/messages.ts'
import { RawClient } from './testing/rawClient.ts'

const SESSION = '11111111-2222-3333-4444-555555555555'

let root: string
let from: string
let to: string
let claudeDir: string
let fake: FakeSdk
let core: Core
let client: RawClient

const history = (folder: string) => join(claudeDir, 'projects', projectDirName(folder))
const transcriptIn = (folder: string) => join(history(folder), `${SESSION}.jsonl`)
// The lines of a stored conversation, as the CLI writes them (the cwd on each message line).
const lines = (cwd: string) => [{ type: 'user', cwd, sessionId: SESSION, message: { role: 'user', content: 'hi' } }, { type: 'summary', summary: 'Hello' }, { type: 'assistant', cwd: join(cwd, 'sub'), sessionId: SESSION }]
// A tab's metadata as the workspace stream last told it (created, then updated).
function meta(tabId = 't1'): { cwd: string; title: string } | undefined {
  const events = client.events(WORKSPACE_STREAM) as { tab?: { tabId: string; cwd: string; title: string } }[]
  return events.flatMap((event) => (event.tab?.tabId === tabId ? [event.tab] : [])).at(-1)
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-move-')))
  from = join(root, 'old-project')
  to = join(root, 'new-project')
  claudeDir = join(root, 'claude')
  mkdirSync(from)
  mkdirSync(to)
  mkdirSync(history(from), { recursive: true })
  writeFileSync(transcriptIn(from), lines(from).map((line) => JSON.stringify(line)).join('\n') + '\n')
  mkdirSync(join(history(from), SESSION, 'subagents'), { recursive: true })
  writeFileSync(join(history(from), SESSION, 'subagents', 'agent-1.jsonl'), JSON.stringify({ type: 'user', cwd: from }) + '\n')
  fake = createFakeSdk()
  core = createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, claudeConfigDir: claudeDir, allowedRoots: [root] })
  client = new RawClient(core)
  await client.hello()
  await client.ok('trust.grant', { cwd: from })
  await client.ok('trust.grant', { cwd: to })
  await client.ok('tab.create', { tabId: 't1', cwd: from, resume: SESSION })
})
afterEach(() => core.closeAll())

describe('moving a session to another folder', () => {
  it('a dormant session: its conversation goes to the new folder, cwd rewritten; the next message resumes it there', async () => {
    expect(await client.ok('tab.move', { tabId: 't1', folder: to })).toEqual({ pending: false })
    expect(existsSync(transcriptIn(from))).toBe(false)
    const moved = readFileSync(transcriptIn(to), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { cwd?: string })
    expect(moved.map((line) => line.cwd)).toEqual([to, undefined, join(to, 'sub')])
    expect(JSON.parse(readFileSync(join(history(to), SESSION, 'subagents', 'agent-1.jsonl'), 'utf8'))).toEqual({ type: 'user', cwd: to })
    expect(existsSync(join(history(from), SESSION))).toBe(false)
    expect(meta()).toMatchObject({ cwd: to })
    await client.ok('tab.send', { tabId: 't1', text: 'go on' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 1)
    expect(fake.last().options).toMatchObject({ cwd: to, resume: SESSION })
  })

  it('the chat says where it went; an automatic title (the folder name) follows the new folder', async () => {
    await client.ok('tab.create', { tabId: 't2', cwd: from })
    await client.ok('tab.move', { tabId: 't2', folder: to })
    expect(meta('t2')).toMatchObject({ cwd: to, title: 'new-project' })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.move', { tabId: 't1', folder: to })
    await client.waitFor(() => JSON.stringify(client.frames).includes(`Session moved to ${to}`))
  })

  it('at work: the turn ends first, then the process goes and the session moves', async () => {
    await client.ok('tab.send', { tabId: 't1', text: 'work' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 1)
    const session = fake.last()
    session.emit(sdk.init(SESSION))
    expect(await client.ok('tab.move', { tabId: 't1', folder: to })).toEqual({ pending: true })
    expect(session.closed).toBe(false)
    expect(meta()).toMatchObject({ cwd: from })
    expect(existsSync(transcriptIn(from))).toBe(true)
    session.emit(sdk.success())
    await client.waitFor(() => session.closed)
    await client.waitFor(() => meta()?.cwd === to)
    expect(existsSync(transcriptIn(to))).toBe(true)
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, crypto.randomUUID())
    await client.waitFor(() => fake.sessions.length === 2)
    expect(fake.last().options).toMatchObject({ cwd: to, resume: SESSION })
  })

  it('a session never sent (nothing stored) just changes folder', async () => {
    await client.ok('tab.create', { tabId: 't3', cwd: from })
    expect(await client.ok('tab.move', { tabId: 't3', folder: to })).toEqual({ pending: false })
    expect(meta('t3')).toMatchObject({ cwd: to })
  })

  it('refuses a folder that does not exist or is outside the Home; the same folder changes nothing', async () => {
    expect((await client.fails('tab.move', { tabId: 't1', folder: join(root, 'missing') })).code).toBe('not_found')
    expect((await client.fails('tab.move', { tabId: 't1', folder: tmpdir() })).code).toBe('outside_root')
    expect(await client.ok('tab.move', { tabId: 't1', folder: from })).toEqual({ pending: false })
    expect(existsSync(transcriptIn(from))).toBe(true)
  })
})

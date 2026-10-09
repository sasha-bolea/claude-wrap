// Rewind (the CLI's /rewind) through the protocol, on the fake SDK. User stories:
// 1. I pick an earlier message of the chat and go back to it: conversation, files, or both;
// 2. the message comes back in the composer, the rest of the chat is gone for every device;
// 3. nothing changes while Claude is working, and queued messages never go onto the rewound chat;
// 4. rewinding to my first message opens a fresh session and leaves the old one as it was.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_STREAM, tabStream, type Item, type TabEvent, type TabMeta, type TabSnapshot, type WorkspaceEvent } from '@athome/protocol'
import { createCore, type Core, type CoreConfig } from './core.ts'
import { createFakeSdk, type FakeSdk } from './testing/fakeQuery.ts'
import { RawClient } from './testing/rawClient.ts'
import { sdk, stored } from './testing/messages.ts'

const CWD = join(mkdtempSync(join(tmpdir(), 'cw-rewind-')), 'demo')
mkdirSync(CWD)
const TAB = tabStream('t1')
const cmd = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let fake: FakeSdk
let core: Core
let client: RawClient

// A core on the fake SDK with fast timers.
function makeCore(overrides: Partial<CoreConfig> = {}): Core {
  return createCore({ backendId: 'test', backendKind: 'local', sdk: fake, coalesceMs: 2, ...overrides })
}

// A raw client past hello, with the test folder trusted.
async function connect(to: Core, clientId?: string): Promise<RawClient> {
  const raw = new RawClient(to, clientId)
  await raw.hello()
  await raw.ok('trust.grant', { cwd: CWD })
  return raw
}

// Latest metadata of a tab as seen on the workspace stream.
function meta(of: RawClient, tabId = 't1'): TabMeta | undefined {
  let tab = (of.lastReset(WORKSPACE_STREAM)?.snapshot as { tabs: TabMeta[] } | undefined)?.tabs.find((t) => t.tabId === tabId)
  const reset = of.frames.lastIndexOf(of.lastReset(WORKSPACE_STREAM)!)
  for (const frame of of.frames.slice(reset + 1)) {
    if (frame.t !== 'ev' || frame.stream !== WORKSPACE_STREAM) continue
    const ev = frame.ev as WorkspaceEvent
    if ((ev.type === 'tab.added' || ev.type === 'tab.updated') && ev.tab.tabId === tabId) tab = ev.tab
    if (ev.type === 'tab.removed' && ev.tabId === tabId) tab = undefined
  }
  return tab
}

// Items of a tab as a client sees them: last snapshot + following events.
function items(of: RawClient, stream = TAB): Item[] {
  const reset = of.lastReset(stream)
  const list = structuredClone((reset?.snapshot as TabSnapshot | undefined)?.items ?? [])
  for (const frame of of.frames.slice(reset ? of.frames.lastIndexOf(reset) + 1 : 0)) {
    if (frame.t !== 'ev' || frame.stream !== stream) continue
    const ev = frame.ev as TabEvent
    if (ev.type === 'item.added') list.push(ev.item)
    if (ev.type === 'item.updated') list[list.findIndex((item) => item.itemId === ev.item.itemId)] = ev.item
  }
  return list
}

const ids = (of: RawClient) => items(of).map((item) => item.itemId)

// A stored session of three exchanges.
function threeExchanges(): void {
  fake.histories.set('s1', [
    stored.user('u1', 'first'),
    stored.assistant('a1', 'm1', [{ type: 'text', text: 'one' }]),
    stored.user('u2', 'second'),
    stored.assistant('a2', 'm2', [{ type: 'text', text: 'two' }]),
    stored.user('u3', 'third'),
    stored.assistant('a3', 'm3', [{ type: 'text', text: 'three' }])
  ])
}

// Opens that session in tab t1 (dormant, history shown) for the client.
async function openHistory(of: RawClient = client): Promise<void> {
  await of.ok('tab.create', { tabId: 't1', cwd: CWD, resume: 's1' })
  await of.ok('tab.subscribe', { tabId: 't1' })
}

beforeEach(async () => {
  fake = createFakeSdk()
  core = makeCore()
  client = await connect(core)
})
afterEach(() => core.closeAll())

describe('rewind points', () => {
  it('lists the prompts and `!` commands of the user, oldest first, without messages of other sessions (as the CLI)', async () => {
    fake.histories.set('s1', [
      stored.user('u1', 'first'),
      stored.assistant('a1', 'm1', [{ type: 'text', text: 'one' }]),
      stored.peer('p1', 'other', 'hello from elsewhere'),
      stored.user('sh1', '<bash-input>ls</bash-input>'),
      stored.user('sh2', '<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>'),
      stored.user('u2', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'with a picture' }])
    ])
    await openHistory()
    const { points } = await client.ok('tab.rewindPoints', { tabId: 't1' })
    expect(points).toEqual([{ itemId: 'u1', text: 'first' }, { itemId: 'sh1', text: '!ls' }, { itemId: 'u2', text: 'with a picture', images: 1 }])
  })

  it('a conversation rewind to a `!` command gives the command back for the composer', async () => {
    fake.histories.set('s1', [
      stored.user('u1', 'first'),
      stored.assistant('a1', 'm1', [{ type: 'text', text: 'one' }]),
      stored.user('sh1', '<bash-input>ls</bash-input>'),
      stored.user('sh2', '<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>')
    ])
    await openHistory()
    const result = await client.ok('tab.rewind', { tabId: 't1', itemId: 'sh1', mode: 'conversation' })
    expect(result.text).toBe('!ls')
    expect(items(client).map((item) => item.itemId)).toEqual(['u1', 'm1:0'])
  })

  it('leaves out queued (pending) messages and everything before a compact boundary', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'before' }, cmd(1))
    await fake.last().waitForInput(1)
    fake.last().emit(sdk.init('s1'), sdk.compactBoundary(), sdk.success())
    await client.waitFor(() => meta(client)?.status === 'idle')
    await client.ok('tab.send', { tabId: 't1', text: 'after' }, cmd(2))
    await client.ok('tab.send', { tabId: 't1', text: 'waiting' }, cmd(3))
    expect(items(client).find((item) => item.itemId === cmd(3))).toMatchObject({ pending: true })
    expect((await client.ok('tab.rewindPoints', { tabId: 't1' })).points).toEqual([{ itemId: cmd(2), text: 'after' }])
  })
})

describe('preview', () => {
  it('starts exactly one process on a dormant tab, asks for a dry run and gives paths relative to the folder', async () => {
    threeExchanges()
    await openHistory()
    const result = { canRewind: true, filesChanged: [join(CWD, 'src', 'a.ts'), 'b.ts'], insertions: 3, deletions: 1 }
    fake.rewindResults.set('u2', result)
    fake.rewindResults.set('u3', result)
    const preview = await client.ok('tab.rewindPreview', { tabId: 't1', itemId: 'u2' })
    await client.ok('tab.rewindPreview', { tabId: 't1', itemId: 'u3' })
    expect(preview).toEqual({ canRewind: true, filesChanged: [join('src', 'a.ts'), 'b.ts'], insertions: 3, deletions: 1 })
    expect(fake.sessions).toHaveLength(1)
    expect(fake.last().received).toEqual([])
    expect(fake.last().rewindCalls).toEqual([{ userMessageId: 'u2', dryRun: true }, { userMessageId: 'u3', dryRun: true }])
  })

  it('an unknown message is not_found', async () => {
    threeExchanges()
    await openHistory()
    expect((await client.fails('tab.rewindPreview', { tabId: 't1', itemId: 'nope' })).code).toBe('not_found')
    expect(fake.sessions).toHaveLength(0)
  })
})

describe('rewinding', () => {
  it('both: files restored, the chat cut before the message on every device, the next process resumes before it', async () => {
    threeExchanges()
    await openHistory()
    const other = await connect(core, 'client-b')
    await other.ok('tab.subscribe', { tabId: 't1' })
    const epochs = [client, other].map((of) => of.lastReset(TAB)?.epoch)
    fake.rewindResults.set('u2', { canRewind: true, filesChanged: [join(CWD, 'a.txt')], skippedLinks: 2 })
    const result = await client.ok('tab.rewind', { tabId: 't1', itemId: 'u2', mode: 'both' })
    expect(result).toEqual({ text: 'second', filesChanged: ['a.txt'], skippedLinks: 2 })
    expect(fake.sessions[0]!.rewindCalls).toEqual([{ userMessageId: 'u2', dryRun: true }, { userMessageId: 'u2', dryRun: undefined }])
    expect(fake.sessions[0]!.closed).toBe(true)
    for (const [index, of] of [client, other].entries()) {
      expect(of.lastReset(TAB)?.epoch).not.toBe(epochs[index])
      expect(ids(of)).toEqual(['u1', 'm1:0'])
    }
    expect(meta(client)?.status).toBe('dormant')
    await client.ok('tab.send', { tabId: 't1', text: 'second, again' }, cmd(5))
    await client.waitFor(() => fake.sessions.length === 2)
    expect(fake.last().options).toMatchObject({ resume: 's1', resumeSessionAt: 'a1' })
    await fake.last().waitForInput(1)
    expect(ids(client)).toEqual(['u1', 'm1:0', cmd(5)])
  })

  it('code: the files only, the chat and the process stay', async () => {
    threeExchanges()
    await openHistory()
    const epoch = client.lastReset(TAB)?.epoch
    fake.rewindResults.set('u2', { canRewind: true, filesChanged: ['a.txt'] })
    const result = await client.ok('tab.rewind', { tabId: 't1', itemId: 'u2', mode: 'code' })
    expect(result).toEqual({ filesChanged: ['a.txt'], skippedLinks: 0 })
    expect(client.lastReset(TAB)?.epoch).toBe(epoch)
    expect(ids(client)).toEqual(['u1', 'm1:0', 'u2', 'm2:0', 'u3', 'm3:0'])
    expect(fake.sessions).toHaveLength(1)
    expect(fake.last().closed).toBe(false)
    expect(meta(client)?.status).toBe('idle')
  })

  it('is refused while a turn runs, and nothing changes', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'hello' }, cmd(1))
    await fake.last().waitForInput(1)
    expect((await client.fails('tab.rewind', { tabId: 't1', itemId: cmd(1), mode: 'both' })).code).toBe('session_busy')
    expect(fake.last().rewindCalls).toEqual([])
    expect(ids(client)).toEqual([cmd(1)])
  })

  it('a refusal of the file rewind is an error with the SDK text and cuts nothing', async () => {
    threeExchanges()
    await openHistory()
    const error = await client.fails('tab.rewind', { tabId: 't1', itemId: 'u2', mode: 'both' })
    expect(error).toMatchObject({ code: 'sdk_error', message: 'No file checkpoint found for this message.' })
    expect(ids(client)).toHaveLength(6)
    expect(meta(client)?.status).toBe('idle')
  })

  it('the first message opens a fresh session in the same folder and leaves the old one untouched', async () => {
    threeExchanges()
    await openHistory()
    await client.ok('tab.setEffort', { tabId: 't1', effort: 'low' })
    fake.rewindResults.set('u1', { canRewind: true, filesChanged: [] })
    const result = await client.ok('tab.rewind', { tabId: 't1', itemId: 'u1', mode: 'both' })
    expect(result).toMatchObject({ text: 'first', filesChanged: [] })
    expect(result.newTabId).toBeTruthy()
    expect(fake.sessions[0]!.rewindCalls).toHaveLength(2)
    // The 6 items of the old session, and the line of the effort change.
    expect(ids(client)).toHaveLength(7)
    expect(meta(client)).toMatchObject({ sessionId: 's1' })
    await client.waitFor(() => meta(client, result.newTabId)?.cwd === CWD)
    expect(meta(client, result.newTabId)).toMatchObject({ status: 'dormant', effort: 'low', sessionId: undefined })
  })
})

describe('queue and persistence', () => {
  it('queued messages wait for ▶ after a conversation rewind and start no process', async () => {
    await client.ok('tab.create', { tabId: 't1', cwd: CWD })
    await client.ok('tab.subscribe', { tabId: 't1' })
    await client.ok('tab.send', { tabId: 't1', text: 'one' }, cmd(1))
    await fake.last().waitForInput(1)
    fake.last().emit(sdk.init('s1'), sdk.success())
    await client.waitFor(() => meta(client)?.status === 'idle')
    await client.ok('tab.send', { tabId: 't1', text: 'two' }, cmd(2))
    await client.ok('tab.queueAdd', { tabId: 't1', text: 'queued' }, cmd(7))
    await client.ok('tab.interrupt', { tabId: 't1' })
    fake.last().emit(sdk.aborted())
    await client.waitFor(() => meta(client)?.status === 'idle')
    fake.histories.set('s1', [stored.user(cmd(1), 'one'), stored.assistant('a1', 'm1', [{ type: 'text', text: 'x' }]), stored.user(cmd(2), 'two')])
    await client.ok('tab.rewind', { tabId: 't1', itemId: cmd(2), mode: 'conversation' })
    expect(meta(client)).toMatchObject({ queue: [{ queueId: cmd(7) }], queuePause: { reason: 'user' } })
    expect(fake.sessions).toHaveLength(1)
    expect(ids(client)).toContain(cmd(1))
    expect(ids(client)).not.toContain(cmd(2))
  })

  it('the cut survives a core restart and is forgotten once the next process reports init', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cw-rewind-state-'))
    const saved = () => (JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as { tabs: { resumeAt?: string }[] }).tabs[0]?.resumeAt
    core = makeCore({ stateDir })
    client = await connect(core)
    threeExchanges()
    await openHistory()
    await client.ok('tab.rewind', { tabId: 't1', itemId: 'u2', mode: 'conversation' })
    await client.waitFor(() => saved() === 'a1')
    await core.closeAll()
    // The stored session still holds the cut messages (nothing was written yet): the restarted core hides them.
    core = makeCore({ stateDir })
    client = await connect(core)
    await client.ok('tab.subscribe', { tabId: 't1' })
    expect(ids(client)).toEqual(['u1', 'm1:0'])
    await client.ok('tab.send', { tabId: 't1', text: 'again' }, cmd(9))
    await client.waitFor(() => fake.sessions.length === 1)
    expect(fake.last().options).toMatchObject({ resume: 's1', resumeSessionAt: 'a1' })
    expect(saved()).toBe('a1')
    fake.last().emit(sdk.init('s1'))
    await client.waitFor(() => saved() === undefined)
  })
})

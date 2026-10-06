// Rewind check on the real CLI (`npm run smoke:rewind`, a few haiku tokens): through core + client, writes then edits
// a file in two turns, lists the rewind points, previews and runs a rewind of code and conversation to turn 2, checks
// the next turn no longer knows turn 2, reports what the SDK stores afterwards (session id, message chain), checks the
// file checkpoints survive the resume, rewinds code only on a reopened (dormant) session, and rewinds to the first
// message (fresh session). Works in a temp folder and deletes the sessions after. Runs directly on Node 24.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair, type Item, type TabMeta } from '@athome/protocol'
import { Connection, type StoreState } from '@athome/client'
import { createCore, type Core } from '../src/index.ts'

const TAB_ID = 'smoke'
const cwd = mkdtempSync(join(tmpdir(), 'athome-smoke-rewind-'))
const file = join(cwd, 'a.txt')
const sessions = new Set<string>()
const problems: string[] = []
const cores: Core[] = []
const connections: Connection[] = []

// A core with a connected client.
function open(name: string): { core: Core; connection: Connection } {
  const core = createCore({ backendId: name, backendKind: 'local' })
  const connection = new Connection({
    openChannel: async () => {
      const [clientEnd, coreEnd] = createChannelPair()
      core.attach(coreEnd)
      return clientEnd
    },
    clientId: name
  })
  cores.push(core)
  connections.push(connection)
  return { core, connection }
}

let { connection } = open('smoke-rewind')

const items = (tabId = TAB_ID): Item[] => connection.store.getSnapshot().transcripts[tabId]?.items ?? []
const meta = (tabId = TAB_ID): TabMeta | undefined => connection.store.getSnapshot().tabs?.find((tab) => tab.tabId === tabId)
const read = (): string => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '<missing>')
const show = (value: unknown): string => JSON.stringify(value)

// Resolves when the store satisfies predicate (checked on every change); false after timeoutMs.
function until(predicate: (state: StoreState) => boolean, timeoutMs = 90_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => (stop(), resolve(false)), timeoutMs)
    const check = () => {
      const id = meta()?.sessionId
      if (id) sessions.add(id)
      if (!predicate(connection.store.getSnapshot())) return
      clearTimeout(timer)
      stop()
      resolve(true)
    }
    const stop = connection.store.subscribe(check)
    check()
  })
}

// Sends a message, allows any tool request, waits for the turn to end. Returns the items it added.
async function send(text: string): Promise<Item[]> {
  const before = items().length
  await connection.request('tab.send', { tabId: TAB_ID, text })
  const requests = () => connection.store.getSnapshot().transcripts[TAB_ID]?.requests ?? []
  const ended = () => items().slice(before).some((item) => item.kind === 'turnEnd') && meta()?.status === 'idle'
  const deadline = Date.now() + 120_000
  while (!ended() && Date.now() < deadline) {
    for (const request of requests()) await connection.request('request.answer', { tabId: TAB_ID, requestId: request.requestId, decision: 'allow' })
    await until(() => ended() || requests().length > 0, 5000)
  }
  const added = items().slice(before)
  console.log(`> ${text}\n${added.map((item) => `    ${item.kind}${'text' in item ? `: ${item.text.replace(/\s+/g, ' ').slice(0, 100)}` : item.kind === 'toolCall' ? `: ${item.name}` : ''}`).join('\n')}`)
  if (!ended()) problems.push(`no turn end for: ${text}`)
  return added
}

// The user item of the transcript with this text.
function userItem(text: string): Extract<Item, { kind: 'user' }> {
  const found = items().find((item): item is Extract<Item, { kind: 'user' }> => item.kind === 'user' && item.text === text)
  if (!found) throw new Error(`no user item "${text}"`)
  return found
}

// The SDK's stored chain of a session, as short lines.
async function chain(sessionId: string): Promise<string[]> {
  const messages = await getSessionMessages(sessionId, { dir: cwd })
  return messages.map((message) => {
    const content = (message.message as { content?: unknown } | undefined)?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: { type: string; text?: string; name?: string }) => part.text ?? part.name ?? part.type).join(' | ') : ''
    return `${message.uuid.slice(0, 8)} ${message.type}: ${text.replace(/\s+/g, ' ').slice(0, 70)}`
  })
}

const T1 = 'Use the Write tool to create a.txt containing exactly: one'
const T2 = 'Use the Edit tool to change a.txt so it contains exactly: two'
const T3 = 'What exact word did I ask you to put in a.txt most recently? Answer with one word.'

async function main(): Promise<void> {
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: TAB_ID, cwd })
  await connection.subscribeTab(TAB_ID)
  await connection.request('tab.send', { tabId: TAB_ID, text: '/model haiku' })
  await until(() => meta()?.status === 'idle', 30_000)

  console.log('\n== 1. two turns')
  await send(T1)
  await send(T2)
  console.log(`a.txt = "${read()}"`)
  if (read() !== 'two') problems.push(`step 1: a.txt is "${read()}", expected two`)

  console.log('\n== 2. rewind points')
  const { points } = await connection.request('tab.rewindPoints', { tabId: TAB_ID })
  console.log(show(points))
  if (!points.some((p) => p.text === T1) || !points.some((p) => p.text === T2)) problems.push('step 2: points miss a prompt')

  console.log('\n== 3. preview on turn 2')
  const t1 = userItem(T1)
  const t2 = userItem(T2)
  const preview = await connection.request('tab.rewindPreview', { tabId: TAB_ID, itemId: t2.itemId })
  console.log(show(preview))
  if (!preview.canRewind || !preview.filesChanged?.some((f) => f.endsWith('a.txt'))) problems.push(`step 3: preview ${show(preview)}`)

  console.log('\n== 4. rewind both to turn 2')
  const sessionBefore = meta()?.sessionId
  const result = await connection.request('tab.rewind', { tabId: TAB_ID, itemId: t2.itemId, mode: 'both' })
  console.log(`result ${show(result)}; a.txt = "${read()}"; transcript now: ${items().map((i) => i.kind).join(', ')}`)
  if (read() !== 'one') problems.push(`step 4: a.txt is "${read()}", expected one`)
  if (result.text !== T2) problems.push(`step 4: result text ${show(result.text)}`)
  if (items().some((item) => item.itemId === t2.itemId) || items().some((item) => item.kind === 'user' && item.text === T2)) problems.push('step 4: transcript still has turn 2')
  if (!items().some((item) => item.itemId === t1.itemId)) problems.push('step 4: transcript lost turn 1')

  console.log('\n== 5. turn 3 after the rewind')
  const added = await send(T3)
  const answer = added.filter((item) => item.kind === 'assistantText').map((item) => ('text' in item ? item.text : '')).join(' ')
  console.log(`answer: "${answer.trim()}"`)
  if (!/\bone\b/i.test(answer) || /\btwo\b/i.test(answer)) problems.push(`step 5: answer "${answer.trim()}"`)

  console.log('\n== 6. session id and stored chain')
  const sessionAfter = meta()?.sessionId
  console.log(`sessionId before ${sessionBefore}, after ${sessionAfter}, same: ${sessionBefore === sessionAfter}`)
  if (sessionAfter) console.log((await chain(sessionAfter)).map((line) => `    ${line}`).join('\n'))
  console.log(`(assumption a: does the chain hold turn 1 and 3 without turn 2? see the lines above)`)

  console.log('\n== 7. checkpoints survive the resume: preview on turn 1')
  const preview1 = await connection.request('tab.rewindPreview', { tabId: TAB_ID, itemId: t1.itemId })
  console.log(show(preview1))
  if (!preview1.canRewind) problems.push(`step 7: preview ${show(preview1)}`)

  console.log('\n== 8. code-only on a dormant, reopened session')
  const finalSession = sessionAfter
  await connection.request('tab.close', { tabId: TAB_ID }).catch(() => undefined)
  const second = open('smoke-rewind-2')
  connection = second.connection
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: 'again', cwd, resume: finalSession })
  await connection.subscribeTab('again')
  console.log(`reopened: ${items('again').map((i) => i.kind).join(', ')}`)
  const again = items('again').find((item): item is Extract<Item, { kind: 'user' }> => item.kind === 'user' && item.text === T1)
  if (!again) problems.push('step 8: turn 1 missing in the reopened session')
  else {
    const code = await connection.request('tab.rewind', { tabId: 'again', itemId: again.itemId, mode: 'code' }).catch((error: unknown) => ({ error: String(error) }))
    console.log(`code rewind: ${show(code)}; a.txt = "${read()}"`)
    if ('error' in code) problems.push(`step 8: ${code.error}`)

    console.log('\n== 9. conversation rewind to the first message')
    const first = await connection.request('tab.rewind', { tabId: 'again', itemId: again.itemId, mode: 'conversation' }).catch((error: unknown) => ({ error: String(error) }))
    console.log(show(first))
    if ('error' in first) problems.push(`step 9: ${first.error}`)
    else {
      if (!first.newTabId) problems.push('step 9: no newTabId')
      console.log(`tabs now: ${show(connection.store.getSnapshot().tabs?.map((tab) => [tab.tabId, tab.sessionId]))}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    problems.push(`crashed: ${String(error)}`)
  })
  .finally(async () => {
    for (const core of cores) await core.closeAll().catch(() => undefined)
    for (const c of connections) c.close()
    for (const id of sessions) await deleteSession(id, { dir: cwd }).catch(() => undefined)
    rmSync(cwd, { recursive: true, force: true })
    console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join('\n- ')}` : '\nOK: rewind on the real CLI behaves as the core assumes')
    process.exit(problems.length ? 1 : 0)
  })

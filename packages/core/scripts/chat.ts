// Phase 1a check (`npm run chat`): chats with the real CLI through core + client over the in-memory transport,
// prints the normalized items and verifies item identity and the user-message uuid in the stored session.
// Uses /model haiku and one short prompt to save quota; works in a temp folder and deletes the session after.
// Runs directly on Node 24 (type stripping).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair, type Item } from '@athome/protocol'
import { Connection, type StoreState } from '@athome/client'
import { createCore } from '../src/index.ts'
import { appAccounts } from './smokeAccounts.ts'

const TAB_ID = 'chat'
const PROMPT = 'Reply with exactly five words about the sea.'

const cwd = mkdtempSync(join(tmpdir(), 'athome-chat-'))
// Sessions run on the launching session's account (see appAccounts).
const accounts = appAccounts()
const core = createCore({ backendId: 'chat-script', backendKind: 'local', ...accounts.config })
const connection = new Connection({
  openChannel: async () => {
    const [clientEnd, coreEnd] = createChannelPair()
    core.attach(coreEnd)
    return clientEnd
  },
  clientId: 'chat-script'
})

const items = (): Item[] => connection.store.getSnapshot().transcripts[TAB_ID]?.items ?? []
const turnEnds = () => items().filter((item) => item.kind === 'turnEnd').length

// Resolves when the store satisfies predicate (checked on every change), or rejects after timeoutMs.
function until(predicate: (state: StoreState) => boolean, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (stop(), reject(new Error('timed out'))), timeoutMs)
    const check = () => {
      if (!predicate(connection.store.getSnapshot())) return
      clearTimeout(timer)
      stop()
      resolve()
    }
    const stop = connection.store.subscribe(check)
    check()
  })
}

// Sends one message and waits for the end of its turn.
async function chat(text: string): Promise<void> {
  const before = turnEnds()
  console.log(`> ${text}`)
  await connection.request('tab.send', { tabId: TAB_ID, text })
  await until(() => turnEnds() > before)
}

// Prints the items, one per line.
function printItems(): void {
  for (const item of items()) {
    const text = 'text' in item ? item.text : item.kind === 'toolCall' ? item.name : item.kind === 'turnEnd' ? JSON.stringify({ ...item, itemId: undefined, sourceUuid: undefined }) : ''
    console.log(`  ${item.kind.padEnd(18)} ${item.itemId.padEnd(40)} ${text.replace(/\s+/g, ' ').slice(0, 80)}`)
  }
}

// Item ids unique, and the stored session holds our cmd id as the user-message uuid. Returns the problems found.
async function verify(sessionId: string): Promise<string[]> {
  const problems: string[] = []
  const ids = items().map((item) => item.itemId)
  if (new Set(ids).size !== ids.length) problems.push('duplicate item ids')
  const sent = items().find((item) => item.kind === 'user' && item.text === PROMPT)
  const stored = await getSessionMessages(sessionId, { dir: cwd })
  if (!sent || !stored.some((message) => message.uuid === sent.itemId)) problems.push('user uuid not found in the stored session')
  if (!items().some((item) => item.kind === 'assistantText' && item.text.trim())) problems.push('no assistant text')
  return problems
}

async function main(): Promise<void> {
  connection.start()
  await connection.request('tab.create', { tabId: TAB_ID, cwd })
  await accounts.useAccount(connection, TAB_ID)
  await connection.subscribeTab(TAB_ID)
  await chat('/model haiku')
  await chat(PROMPT)
  const tab = connection.store.getSnapshot().tabs?.find((candidate) => candidate.tabId === TAB_ID)
  console.log(`\nitems (session ${tab?.sessionId}, model ${tab?.activeModel}):`)
  printItems()
  await core.closeAll()
  connection.close()
  const problems = tab?.sessionId ? await verify(tab.sessionId) : ['no session id']
  if (tab?.sessionId) await deleteSession(tab.sessionId, { dir: cwd })
  rmSync(cwd, { recursive: true, force: true })
  console.log(problems.length ? `\nPROBLEMS: ${problems.join('; ')}` : '\nOK: unique item ids, uuid stored, assistant text present')
  process.exitCode = problems.length ? 1 : 0
}

main().catch(async (error) => {
  console.error(error)
  await core.closeAll()
  process.exit(1)
})

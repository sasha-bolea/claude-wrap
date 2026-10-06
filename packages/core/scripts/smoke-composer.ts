// Phase 2 and sub-phase B check on the real CLI (`npm run smoke:composer`, a few haiku tokens): through core + client,
// runs palette commands and reports what each one shows, sends an image and checks the model sees it, runs a `!`
// command and checks it starts no turn but reaches the model, sends a message while a tool runs and checks it is read
// in the same turn, presses "Invia ora" on a message waiting during a long tool and checks Claude reads it at once,
// applies an effort level, checks the session's name for the other sessions follows the tab's title (after the first
// prompt, then a rename), and reopens the stored session to check its history.
// Works in a temp folder and deletes the sessions after. Runs directly on Node 24 (type stripping).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair, type Item, type TabMeta } from '@athome/protocol'
import { Connection, type StoreState } from '@athome/client'
import { createCore } from '../src/index.ts'
import { appAccounts } from './smokeAccounts.ts'

const TAB_ID = 'smoke'
// Cheap commands of the palette (✓b rows of the parity map) and what they should show.
const COMMANDS = ['/model haiku', '/context', '/cost', '/effort low', '/compact', '/clear']

// Sessions run on the launching session's account (see appAccounts).
const accounts = appAccounts()
const cwd = mkdtempSync(join(tmpdir(), 'athome-smoke-'))
const core = createCore({ backendId: 'smoke-script', backendKind: 'local', ...accounts.config })
const connection = new Connection({
  openChannel: async () => {
    const [clientEnd, coreEnd] = createChannelPair()
    core.attach(coreEnd)
    return clientEnd
  },
  clientId: 'smoke-script'
})
const sessions = new Set<string>()
const problems: string[] = []

const items = (): Item[] => connection.store.getSnapshot().transcripts[TAB_ID]?.items ?? []
const meta = (): TabMeta | undefined => connection.store.getSnapshot().tabs?.find((tab) => tab.tabId === TAB_ID)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

// Text of an item for the report.
function describe(item: Item): string {
  const text = 'text' in item ? item.text : item.kind === 'shell' ? `${item.command} → ${item.output}` : item.kind === 'toolCall' ? item.name : ''
  return `${item.kind}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 100)}` : ''}`
}

// Sends a message and waits for its turn to end (or the transcript to be reset). Returns the items it added.
async function send(text: string, extra: object = {}): Promise<Item[]> {
  const before = items().length
  const epochItems = items()
  await connection.request('tab.send', { tabId: TAB_ID, text, ...extra })
  const ended = await until(() => items() !== epochItems && meta()?.status === 'idle' && (items().length < before || items().slice(before).some((item) => item.kind === 'turnEnd')))
  const added = items().length < before ? items() : items().slice(before)
  console.log(`> ${text}${ended ? '' : '   (no turn end within 90 s)'}\n${added.map((item) => `    ${describe(item)}`).join('\n')}`)
  return added
}

// A 16×16 PNG filled with one colour.
function solidPng(red: number, green: number, blue: number): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(16, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.from([0, ...Array.from({ length: 16 }, () => [red, green, blue]).flat()])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)))
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}

// Each palette command must show something besides the echo of the command (output, compaction, reset…).
async function checkCommands(): Promise<void> {
  const { commands } = await connection.request('tab.commands', { tabId: TAB_ID })
  console.log(`palette: ${commands.length} commands (${commands.slice(0, 12).map((command) => command.name).join(', ')}, …)`)
  for (const command of COMMANDS) {
    const before = items()
    const added = await send(command)
    const reset = items().length < before.length || command === '/clear'
    if (!reset && !added.some((item) => item.kind !== 'user' && item.kind !== 'turnEnd')) problems.push(`${command} showed nothing`)
    if (command === '/model haiku') await send('Say hi in two words.')
  }
}

async function checkImage(): Promise<void> {
  const added = await send('What single colour fills this image? Answer with one word.', { images: [{ mediaType: 'image/png', data: solidPng(220, 20, 20) }] })
  // The user's settings may make the model answer in another language (seen: "Rosso").
  if (!added.some((item) => item.kind === 'assistantText' && /red|rosso|rojo|rouge|rot/i.test(item.text))) problems.push('the model did not see the red image')
}

async function checkShell(): Promise<void> {
  const before = items().length
  await connection.request('tab.shell', { tabId: TAB_ID, command: 'echo smoke-marker-42' })
  await sleep(3000)
  const added = items().slice(before)
  console.log(`> !echo smoke-marker-42\n${added.map((item) => `    ${describe(item)}`).join('\n')}`)
  if (added.some((item) => item.kind !== 'shell')) problems.push('the shell command added more than its shell item (a turn started?)')
  if (meta()?.status !== 'idle') problems.push(`status after the shell command: ${meta()?.status}`)
  const answer = await send('What did my last shell command print? Reply with only its output.')
  if (!answer.some((item) => item.kind === 'assistantText' && item.text.includes('smoke-marker-42'))) problems.push('the model did not see the shell output')
}

// Sub-phase B: a message sent while a tool runs goes at once, is pending until the CLI reads it, and is answered in the
// same turn.
const LATE = 'Also: end your final reply with the word PINEAPPLE.'
async function checkMidTurn(): Promise<void> {
  const ends = () => items().filter((item) => item.kind === 'turnEnd').length
  const before = ends()
  await connection.request('tab.send', { tabId: TAB_ID, text: 'Run exactly this Bash command: sleep 6 && echo first-done. Then reply with one short sentence.' })
  // The Bash call may ask for permission (it depends on the user's settings): allowed from here, like a tap in the app.
  const requests = () => connection.store.getSnapshot().transcripts[TAB_ID]?.requests ?? []
  const toolRunning = () => items().some((item) => item.kind === 'toolCall' && item.name === 'Bash' && item.result === undefined)
  await until(() => toolRunning() || requests().length > 0, 60_000)
  const [request] = requests()
  if (request) await connection.request('request.answer', { tabId: TAB_ID, requestId: request.requestId, decision: 'allow' })
  await until(toolRunning, 30_000)
  await sleep(1500)
  await connection.request('tab.send', { tabId: TAB_ID, text: LATE })
  const pending = () => items().some((item) => item.kind === 'user' && item.text === LATE && item.pending === true)
  const pendingSeen = pending()
  await until(() => ends() > before && meta()?.status === 'idle')
  console.log(`> mid-turn: pending when sent ${pendingSeen}; turns ended ${ends() - before}; items now:\n${items().slice(-4).map((item) => `    ${describe(item)}`).join('\n')}`)
  if (!pendingSeen) problems.push('the message sent mid-turn was not pending')
  if (pending()) problems.push('the message sent mid-turn stayed pending')
  if (ends() - before !== 1) problems.push(`expected the late message read in the same turn, saw ${ends() - before} turn ends`)
  if (!items().some((item) => item.kind === 'assistantText' && item.text.includes('PINEAPPLE'))) problems.push('the model did not read the message sent mid-turn')
}

// "Invia ora" on a message waiting during a long tool: the CLI's own send-now makes Claude read it well before the
// tool would have ended.
async function checkSendNow(): Promise<void> {
  const requests = () => connection.store.getSnapshot().transcripts[TAB_ID]?.requests ?? []
  const toolRunning = () => items().some((item) => item.kind === 'toolCall' && item.name === 'Bash' && item.result === undefined)
  await connection.request('tab.send', { tabId: TAB_ID, text: 'Run exactly this Bash command: sleep 20 && echo slow-done. Then reply with one short sentence.' })
  await until(() => toolRunning() || requests().length > 0, 60_000)
  const [request] = requests()
  if (request) await connection.request('request.answer', { tabId: TAB_ID, requestId: request.requestId, decision: 'allow' })
  await until(toolRunning, 30_000)
  await sleep(1500)
  const word = 'MANGO'
  await connection.request('tab.send', { tabId: TAB_ID, text: `Reply with the word ${word} and nothing else.` })
  const late = () => items().find((item) => item.kind === 'user' && item.text.includes(word))
  const waiting = () => {
    const item = late()
    return item?.kind === 'user' && item.pending === true
  }
  await until(waiting, 10_000)
  const pressed = Date.now()
  await connection.request('tab.sendPendingNow', { tabId: TAB_ID, itemId: late()!.itemId })
  if (!(await until(() => !waiting(), 15_000))) problems.push('send now: the message stayed waiting')
  const readAfter = Date.now() - pressed
  if (!(await until(() => items().some((item) => item.kind === 'assistantText' && item.text.includes(word)), 60_000))) problems.push('send now: the model did not answer the message')
  console.log(`> send now: read ${readAfter} ms after the tap; items now:\n${items().slice(-4).map((item) => `    ${describe(item)}`).join('\n')}`)
  if (readAfter > 12_000) problems.push(`send now: read only after ${readAfter} ms (the tool ran 20 s)`)
  await until(() => meta()?.status === 'idle', 60_000)
}

// "Annulla invio" on a message waiting during a long tool: the CLI's cancel_async_message withdraws it, the text comes
// back, and Claude never answers it. Then the same call on a message the CLI already read fails.
async function checkUnsend(): Promise<void> {
  const requests = () => connection.store.getSnapshot().transcripts[TAB_ID]?.requests ?? []
  const toolRunning = () => items().some((item) => item.kind === 'toolCall' && item.name === 'Bash' && item.result === undefined)
  await connection.request('tab.send', { tabId: TAB_ID, text: 'Run exactly this Bash command: sleep 12 && echo unsend-done. Then reply with one short sentence.' })
  await until(() => toolRunning() || requests().length > 0, 60_000)
  const [request] = requests()
  if (request) await connection.request('request.answer', { tabId: TAB_ID, requestId: request.requestId, decision: 'allow' })
  await until(toolRunning, 30_000)
  await sleep(1500)
  const word = 'GUAVA'
  await connection.request('tab.send', { tabId: TAB_ID, text: `Reply with the word ${word} and nothing else.` })
  const late = () => items().find((item) => item.kind === 'user' && item.text.includes(word))
  const waiting = () => {
    const item = late()
    return item?.kind === 'user' && item.pending === true
  }
  if (!(await until(waiting, 10_000))) return void problems.push('unsend: the message never showed as waiting')
  const result = await connection.request('tab.unsendPending', { tabId: TAB_ID, itemId: late()!.itemId }).catch((error: unknown) => (problems.push(`unsend failed: ${String(error)}`), undefined))
  console.log(`> unsend: returned ${JSON.stringify(result)}; message still in chat: ${Boolean(late())}`)
  if (result && !result.text.includes(word)) problems.push('unsend: the text did not come back')
  if (late()) problems.push('unsend: the message stayed in the chat')
  await until(() => meta()?.status === 'idle', 60_000)
  await sleep(1500)
  if (items().some((item) => item.kind === 'assistantText' && item.text.includes(word))) problems.push('unsend: Claude answered the withdrawn message')
  if (late()) problems.push('unsend: the withdrawn message came back after the turn')
  // A message read already cannot be withdrawn (the CLI answers cancelled: false).
  const read = items().findLast((item) => item.kind === 'user')
  const failed = read ? await connection.request('tab.unsendPending', { tabId: TAB_ID, itemId: read.itemId }).then(() => false, () => true) : false
  if (!failed) problems.push('unsend: a message already read could be withdrawn')
}

// Sub-phase B: models with their effort levels; the effort applied to the live session like /effort.
async function checkEffort(): Promise<void> {
  const { models } = await connection.request('tab.models', { tabId: TAB_ID })
  console.log(`models: ${models.map((model) => `${model.value} = ${model.displayName} [${model.supportedEffortLevels?.join(' ') ?? 'no effort'}]`).join('; ')}`)
  await connection.request('tab.setEffort', { tabId: TAB_ID, effort: 'low' }).catch((error: unknown) => problems.push(`setEffort failed: ${String(error)}`))
  const added = await send('Say done in one word.')
  if (!added.some((item) => item.kind === 'assistantText')) problems.push('no answer after the effort change')
}

// The name the running CLI of a session registered for the other sessions (ListAgents), from <config>/sessions.
function registeredName(sessionId: string): string | undefined {
  const dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions')
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { sessionId?: string; name?: string }
      if (entry.sessionId === sessionId) return entry.name
    } catch {
      // an entry being rewritten: read again at the next poll
    }
  }
  return undefined
}

// Resolves true once condition holds (polled every 250 ms), false after timeoutMs.
async function eventually(condition: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 250))) if (condition()) return true
  return condition()
}

// The session's name for the other sessions is the tab's title: the one it took after the first prompt (the CLI
// started with CLAUDE_CODE_SESSION_NAME, then rename_session), then the name the user gives.
async function checkSessionName(): Promise<void> {
  const sessionId = meta()?.sessionId
  if (!sessionId) return void problems.push('no session id for the name check')
  const followed = await eventually(() => registeredName(sessionId) === meta()?.title)
  console.log(`> session name: "${registeredName(sessionId)}", tab title "${meta()?.title}"`)
  if (!followed) problems.push('the session name is not the tab title')
  await connection.request('tab.rename', { tabId: TAB_ID, title: 'smoke-renamed' })
  const renamed = await eventually(() => registeredName(sessionId) === 'smoke-renamed')
  console.log(`> after rename: "${registeredName(sessionId)}"`)
  if (!renamed) problems.push('renaming the tab did not rename the live session')
}

// Sub-phase B: the stored session, opened again in a new core, shows the message read mid-turn once, in its place.
async function checkHistory(sessionId: string): Promise<void> {
  const fresh = createCore({ backendId: 'smoke-history', backendKind: 'local', ...accounts.config })
  const reader = new Connection({
    openChannel: async () => {
      const [clientEnd, coreEnd] = createChannelPair()
      fresh.attach(coreEnd)
      return clientEnd
    },
    clientId: 'smoke-history'
  })
  reader.start()
  await reader.request('tab.create', { tabId: 'history', cwd, resume: sessionId })
  await accounts.useAccount(reader, 'history')
  await reader.subscribeTab('history')
  const users = (reader.store.getSnapshot().transcripts['history']?.items ?? []).filter((item) => item.kind === 'user')
  console.log(`> history: ${users.length} user items, the late one ${users.filter((item) => item.kind === 'user' && item.text === LATE).length} time(s)`)
  if (users.filter((item) => item.kind === 'user' && item.text === LATE).length !== 1) problems.push('the stored session does not show the mid-turn message exactly once')
  await fresh.closeAll()
  reader.close()
}

async function main(): Promise<void> {
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: TAB_ID, cwd })
  await accounts.useAccount(connection, TAB_ID)
  await connection.subscribeTab(TAB_ID)
  await checkCommands()
  await checkImage()
  await checkShell()
  await checkMidTurn()
  await checkSendNow()
  await checkUnsend()
  await checkEffort()
  await checkSessionName()
  const sessionId = meta()?.sessionId
  await core.closeAll()
  connection.close()
  if (sessionId) await checkHistory(sessionId)
  for (const id of sessions) await deleteSession(id, { dir: cwd }).catch(() => undefined)
  rmSync(cwd, { recursive: true, force: true })
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join('\n- ')}` : '\nOK: commands visible, image seen, shell without a turn and seen, mid-turn message read, effort applied, session name follows the tab, history right')
  process.exitCode = problems.length ? 1 : 0
}

main().catch(async (error) => {
  console.error(error)
  await core.closeAll()
  process.exit(1)
})

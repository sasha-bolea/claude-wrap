// Phase 2 check on the real CLI (`npm run smoke:composer`, a few haiku tokens): through core + client, runs palette
// commands and reports what each one shows, sends an image and checks the model sees it, runs a `!` command and
// checks it starts no turn but reaches the model, and queues a message behind a running turn.
// Works in a temp folder and deletes the sessions after. Runs directly on Node 24 (type stripping).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair, type Item, type TabMeta } from '@claude-wrap/protocol'
import { Connection, type StoreState } from '@claude-wrap/client'
import { createCore } from '../src/index.ts'

const TAB_ID = 'smoke'
// Cheap commands of the palette (✓b rows of the parity map) and what they should show.
const COMMANDS = ['/model haiku', '/context', '/cost', '/effort low', '/compact', '/clear']

const cwd = mkdtempSync(join(tmpdir(), 'claude-wrap-smoke-'))
const core = createCore({ backendId: 'smoke-script', backendKind: 'local' })
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

async function checkQueue(): Promise<void> {
  const before = items().filter((item) => item.kind === 'turnEnd').length
  await connection.request('tab.send', { tabId: TAB_ID, text: 'Count from 1 to 15, one number per line.' })
  await connection.request('tab.send', { tabId: TAB_ID, text: 'Now say OK.' })
  const queued = meta()?.queue.length
  await until(() => items().filter((item) => item.kind === 'turnEnd').length >= before + 2 && meta()?.status === 'idle')
  console.log(`> queue: ${queued} queued while running; items now:\n${items().slice(-4).map((item) => `    ${describe(item)}`).join('\n')}`)
  if (queued !== 1) problems.push(`expected 1 queued message, saw ${queued}`)
  if (!items().some((item) => item.kind === 'user' && item.text === 'Now say OK.')) problems.push('the queued message was not dispatched')
}

async function main(): Promise<void> {
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: TAB_ID, cwd })
  await connection.subscribeTab(TAB_ID)
  await checkCommands()
  await checkImage()
  await checkShell()
  await checkQueue()
  await core.closeAll()
  connection.close()
  for (const sessionId of sessions) await deleteSession(sessionId, { dir: cwd }).catch(() => undefined)
  rmSync(cwd, { recursive: true, force: true })
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join('\n- ')}` : '\nOK: commands visible, image seen, shell without a turn and seen, queue dispatched')
  process.exitCode = problems.length ? 1 : 0
}

main().catch(async (error) => {
  console.error(error)
  await core.closeAll()
  process.exit(1)
})

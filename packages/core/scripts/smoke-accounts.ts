// Claude accounts on the real CLI (`npm run smoke:accounts`; the bad-token turn costs nothing, the login turn a few
// haiku tokens): a session with an account runs the CLI with that account's token (a well-formed but invalid token
// must fail to authenticate), then switches back to Claude Code's own login in the same conversation and gets an
// answer (or the account's usage limit, shown as the session's limitedUntil). Works in a temp folder and deletes the
// session after. Runs directly on Node 24 (type stripping).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair, type Item, type TabMeta } from '@athome/protocol'
import { Connection, type StoreState } from '@athome/client'
import { createCore } from '../src/index.ts'

const TAB_ID = 'accounts'
const BAD_TOKEN = `sk-ant-oat01-${'x'.repeat(60)}`

const cwd = mkdtempSync(join(tmpdir(), 'athome-accounts-'))
const core = createCore({ backendId: 'smoke-accounts', backendKind: 'local' })
const connection = new Connection({
  openChannel: async () => {
    const [clientEnd, coreEnd] = createChannelPair()
    core.attach(coreEnd)
    return clientEnd
  },
  clientId: 'smoke-accounts'
})
const problems: string[] = []
const items = (): Item[] => connection.store.getSnapshot().transcripts[TAB_ID]?.items ?? []
const meta = (): TabMeta | undefined => connection.store.getSnapshot().tabs?.find((tab) => tab.tabId === TAB_ID)

// Resolves when the store satisfies predicate (checked on every change); false after timeoutMs.
function until(predicate: (state: StoreState) => boolean, timeoutMs = 90_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => (stop(), resolve(false)), timeoutMs)
    const check = () => {
      if (!predicate(connection.store.getSnapshot())) return
      clearTimeout(timer)
      stop()
      resolve(true)
    }
    const stop = connection.store.subscribe(check)
    check()
  })
}

// Sends a message and waits for its turn to end, the process to fail, or the account's limit. Returns the new items.
async function send(text: string): Promise<Item[]> {
  const before = items().length
  await connection.request('tab.send', { tabId: TAB_ID, text }).catch((error: unknown) => problems.push(`send failed: ${String(error)}`))
  await until(() => meta()?.status === 'error' || Boolean(meta()?.limitedUntil) || (meta()?.status === 'idle' && items().slice(before).some((item) => item.kind === 'turnEnd')))
  const added = items().slice(before)
  console.log(`> ${text} [account ${meta()?.account ?? 'login'}] → status ${meta()?.status}${meta()?.error ? ` (${meta()!.error!.split('\n')[0]})` : ''}`)
  for (const item of added) console.log(`    ${item.kind}${'text' in item ? `: ${item.text.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
  return added
}

async function main(): Promise<void> {
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: TAB_ID, cwd, model: 'haiku' })
  await connection.subscribeTab(TAB_ID)
  const { accountId } = await connection.request('accounts.add', { name: 'Bad token', token: BAD_TOKEN })
  await connection.request('tab.setAccount', { tabId: TAB_ID, accountId })
  const bad = await send('Say hi in two words.')
  const answered = bad.some((item) => item.kind === 'assistantText' && !/auth|401|token|login|invalid/i.test(item.text))
  if (answered) problems.push('the invalid token was not used: the CLI answered')
  await connection.request('tab.setAccount', { tabId: TAB_ID, accountId: undefined })
  if (meta()?.status === 'error') await connection.request('tab.restart', { tabId: TAB_ID }).catch(() => undefined)
  const good = await send('Say hi in two words.')
  const limited = Boolean(meta()?.limitedUntil)
  if (!limited && !good.some((item) => item.kind === 'assistantText')) problems.push('no answer with the login after switching back')
  if (limited) console.log(`login account at its usage limit until ${new Date(meta()!.limitedUntil!).toLocaleTimeString()} (shown to the session)`)
  const sessionId = meta()?.sessionId
  await core.closeAll()
  if (sessionId) await deleteSession(sessionId, { dir: cwd }).catch(() => undefined)
  rmSync(cwd, { recursive: true, force: true })
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join('\n- ')}` : 'OK: the account token reaches the CLI; back to the login in the same conversation')
  process.exit(problems.length ? 1 : 0)
}

void main()

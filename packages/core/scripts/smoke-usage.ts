// Context and usage on the real CLI (`npm run smoke:usage`; no message is sent, zero tokens): a fresh tab starts its
// process for tab.context and tab.usage, and both answers pass the protocol's schemas with sane numbers (a window, a
// share, the categories; the session's cost; plan limits or null), and the composer's gauges are read from the live
// process. The usage call is the SDK's experimental one: this is the check that an SDK bump did not rename or break
// it. Works in a temp folder. Runs directly on Node 24.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChannelPair } from '@claude-wrap/protocol'
import { Connection } from '@claude-wrap/client'
import { createCore } from '../src/index.ts'

const TAB_ID = 'usage'

const cwd = mkdtempSync(join(tmpdir(), 'claude-wrap-usage-'))
const core = createCore({ backendId: 'smoke-usage', backendKind: 'local' })
const connection = new Connection({
  openChannel: async () => {
    const [clientEnd, coreEnd] = createChannelPair()
    core.attach(coreEnd)
    return clientEnd
  },
  clientId: 'smoke-usage'
})
const problems: string[] = []

async function main(): Promise<void> {
  connection.start()
  await connection.request('trust.grant', { cwd })
  await connection.request('tab.create', { tabId: TAB_ID, cwd, model: 'haiku' })
  const context = await connection.request('tab.context', { tabId: TAB_ID }).catch((error: unknown) => void problems.push(`tab.context failed: ${String(error)}`))
  if (context) {
    console.log(`context: ${context.model} ${context.totalTokens} / ${context.maxTokens} tokens (${context.percentage}%), autocompact ${context.autoCompact ? context.autoCompactThreshold ?? 'on' : 'off'}`)
    for (const row of context.categories) console.log(`    ${row.kind.padEnd(8)} ${row.name}: ${row.tokens}`)
    if (!(context.maxTokens > 0 && context.totalTokens > 0)) problems.push('the context has no window or no tokens')
    if (!context.categories.some((row) => row.kind === 'used')) problems.push('no category fills the window')
  }
  const usage = await connection.request('tab.usage', { tabId: TAB_ID }).catch((error: unknown) => void problems.push(`tab.usage failed: ${String(error)}`))
  if (usage) {
    console.log(`usage: session $${usage.session.costUsd}, plan ${usage.subscription ?? 'none'}`)
    console.log(`limits: ${usage.limits ? JSON.stringify(usage.limits) : 'none (API key or unreadable)'}`)
    if (usage.subscription && !usage.limits) console.log('note: a subscription without readable limits (the claude.ai endpoint did not answer)')
  }
  // The composer's gauges: read from the live process (a summary context answer, the plan windows).
  await connection.request('tab.refreshGauges', { tabId: TAB_ID }).catch((error: unknown) => void problems.push(`tab.refreshGauges failed: ${String(error)}`))
  const meta = connection.store.getSnapshot().tabs?.find((tab) => tab.tabId === TAB_ID)
  console.log(`gauges: context ${JSON.stringify(meta?.context)}, plan ${JSON.stringify(meta?.planLimits)}`)
  if (!meta?.context?.maxTokens) problems.push('no context gauge after tab.refreshGauges')
  await core.closeAll()
  rmSync(cwd, { recursive: true, force: true })
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join('\n- ')}` : 'OK: context and usage answer from the real CLI and pass the protocol')
  process.exit(problems.length ? 1 : 0)
}

void main()

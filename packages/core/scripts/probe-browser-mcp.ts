// Browser MCP probe (`npm run probe:browser-mcp`): zero Claude tokens. Starts a real session through core on a
// workspace with the shared browser (real Chromium, our Playwright MCP command), runs the local `/context` command
// to get past init, then prints the `playwright` MCP server as the session sees it: whether our command
// (--cdp-endpoint) or the user's own (~/.claude.json, --isolated) won the name. Runs directly on Node 24.
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type McpServerStatus, type Query } from '@anthropic-ai/claude-agent-sdk'
import { createCore } from '../src/index.ts'
import { RawClient } from '../src/testing/rawClient.ts'
import { playwrightMcp } from '../../server/src/config.ts'

const PORT = 3099
const CHROME = process.env.CLAUDE_WRAP_CHROME ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1247', 'chrome-linux64', 'chrome')

// Runs the probe; returns the status entries of the MCP servers named playwright or browser.
async function main(): Promise<void> {
  const mcp = playwrightMcp(PORT)
  if (!mcp) throw new Error('@playwright/mcp is not installed')
  const root = mkdtempSync(join(tmpdir(), 'athome-probe-browser-'))
  let live: Query | undefined
  const core = createCore({
    backendId: 'probe', backendKind: 'remote', coalesceMs: 2,
    sdk: { query: ((params: Parameters<typeof query>[0]) => (live = query(params))) as typeof query },
    browser: { port: PORT, executable: CHROME, profileDir: join(root, 'profile'), mcp }
  })
  const client = new RawClient(core)
  try {
    await client.hello()
    await client.ok('trust.grant', { cwd: root })
    await (await core.browser())!.ensure()
    await client.ok('tab.create', { tabId: 'p', cwd: root })
    await client.ok('tab.send', { tabId: 'p', text: '/context' })
    await client.waitFor(() => live !== undefined, 60_000)
    await new Promise((resolve) => setTimeout(resolve, 8000))
    const servers = await live!.mcpServerStatus()
    console.log('our command:', JSON.stringify(mcp))
    for (const server of servers.filter((s: McpServerStatus) => /playwright|browser/.test(s.name)))
      console.log(JSON.stringify({ name: server.name, status: server.status, scope: server.scope, source: server.source, config: server.config, error: server.error }, null, 2))
    console.log(servers.length ? '' : 'no MCP servers reported')
  } finally {
    client.close()
    await core.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
}

main().then(() => process.exit(0), (error) => (console.error(error), process.exit(1)))

// The inspect commands on the real CLI (`npm run smoke:inspect`; no message is sent, zero tokens): tab.status, tab.mcp,
// tab.mcpToggle / mcpReconnect, tab.mcpAuth / mcpAuthCallback / mcpClearAuth, tab.hooks and tab.permissions (rules and
// folders added to and removed from the temp folder's settings files) answer and pass the protocol. Runs in a temp
// folder with a project .mcp.json (a tiny stdio MCP server and an http server behind a fake OAuth endpoint) and a
// SessionStart hook. The runtime-only SDK calls (getStatus, getHooksListing) are also printed raw, to compare with what
// inspect.ts maps. The only change outside the temp folder is the CLI's own toggle in ~/.claude.json (projects[<temp
// folder>]), toggled back at the end. Runs directly on Node 24.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import * as claudeSdk from '@anthropic-ai/claude-agent-sdk'
import { createChannelPair } from '@athome/protocol'
import { Connection } from '@athome/client'
import { createCore } from '../src/index.ts'
import { appAccounts } from './smokeAccounts.ts'

const TAB_ID = 'inspect'
const problems: string[] = []

// The source of the tiny stdio MCP server (newline-delimited JSON-RPC: initialize, tools/list, notifications).
const STDIO_SERVER = `
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const send = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
    if (message.method === 'initialize') send({ protocolVersion: message.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'tiny', version: '1.0.0' } })
    else if (message.method === 'tools/list') send({ tools: [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] })
    else if (message.method === 'ping') send({})
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no such method' } }) + '\\n')
  }
})
`

// A local fake OAuth-protected MCP endpoint: 401 with WWW-Authenticate and the OAuth metadata documents.
// Returns the server and its base URL.
async function startFakeOauth(): Promise<{ server: Server; base: string }> {
  let base = ''
  const server = createServer((request, response) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers })
      response.end(JSON.stringify(body))
    }
    const path = (request.url ?? '').split('?')[0] ?? ''
    if (path.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${base}/mcp`, authorization_servers: [base] })
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      })
    }
    if (path === '/register') return json(201, { client_id: 'fake-client', redirect_uris: [], token_endpoint_auth_method: 'none' })
    if (path === '/token') return json(400, { error: 'invalid_grant' })
    request.resume()
    json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, base }
}

// The projects[<folder>] entry of ~/.claude.json (the CLI's own per-project state); only this sub-object is read.
function projectEntry(cwd: string): Record<string, unknown> | undefined {
  const all = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as { projects?: Record<string, Record<string, unknown>> }
  return all.projects?.[cwd]
}

// Prints a value trimmed to a length.
function show(label: string, value: unknown, limit = 700): void {
  const text = JSON.stringify(value) ?? 'undefined'
  console.log(`${label}: ${text.length > limit ? `${text.slice(0, limit)}...(${text.length} chars)` : text}`)
}

// Records and prints a PASS/FAIL line.
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`)
  if (!ok) problems.push(what)
}

// Waits until a condition holds (polling), up to a time.
async function until(condition: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await condition().catch(() => false)) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'athome-inspect-'))
  const oauth = await startFakeOauth()
  mkdirSync(join(cwd, '.claude'))
  writeFileSync(join(cwd, 'tiny-mcp.mjs'), STDIO_SERVER)
  writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { tiny: { command: 'node', args: [join(cwd, 'tiny-mcp.mjs')] }, fake: { type: 'http', url: `${oauth.base}/mcp` } } }))
  writeFileSync(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello-hook' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre-tool' }] }] } })
  )
  writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: true }))

  // The raw Query is captured through the SDK entry point core uses.
  let rawQuery: Query | undefined
  const sdk = {
    query: ((params: Parameters<typeof claudeSdk.query>[0]) => {
      rawQuery = claudeSdk.query(params)
      return rawQuery
    }) as typeof claudeSdk.query
  }
  const accounts = appAccounts()
  const core = createCore({ backendId: 'smoke-inspect', backendKind: 'local', sdk, ...accounts.config })
  const connection = new Connection({
    openChannel: async () => {
      const [clientEnd, coreEnd] = createChannelPair()
      core.attach(coreEnd)
      return clientEnd
    },
    clientId: 'smoke-inspect'
  })
  try {
    connection.start()
    await connection.request('trust.grant', { cwd })
    await connection.request('tab.create', { tabId: TAB_ID, cwd, model: 'haiku' })
    await accounts.useAccount(connection, TAB_ID)

    console.log('\n== 1. tab.status')
    const status = await connection.request('tab.status', { tabId: TAB_ID })
    for (const section of status.sections) console.log(`  [${section.title}] ${section.rows.map((row) => `${row.label}=${row.value}`).join(' | ').slice(0, 300)}`)
    show('settingsFiles', status.settingsFiles)
    check(status.sections.length > 0, 'status has sections')
    check(status.settingsFiles.some((file) => file.path.includes(cwd)), 'settingsFiles lists the project files')
    const raw = rawQuery as unknown as { getStatus(): Promise<unknown>; getHooksListing(): Promise<unknown> }

    console.log('\n== 2. tab.mcp')
    let servers = (await connection.request('tab.mcp', { tabId: TAB_ID })).servers
    await until(async () => (servers = (await connection.request('tab.mcp', { tabId: TAB_ID })).servers).every((server) => server.status !== 'pending'), 20_000)
    for (const server of servers) show(`  ${server.name}`, server)
    const tiny = () => servers.find((server) => server.name === 'tiny')
    const fake = servers.find((server) => server.name === 'fake')
    check(tiny()?.status === 'connected' && tiny()?.tools === 1, 'stdio server connected with 1 tool')
    check(fake?.status === 'needs-auth' || fake?.status === 'failed', `http server needs-auth or failed (${fake?.status})`)
    const refresh = async () => (servers = (await connection.request('tab.mcp', { tabId: TAB_ID })).servers)

    console.log('\n== 3. tab.mcpToggle')
    const before = projectEntry(cwd)
    show('projects entry before (keys)', before ? Object.keys(before) : null)
    await connection.request('tab.mcpToggle', { tabId: TAB_ID, name: 'tiny', enabled: false })
    await until(async () => (await refresh(), tiny()?.status === 'disabled'), 8000)
    show('  tiny after off', tiny())
    check(tiny()?.status === 'disabled', 'stdio server disabled after toggle off')
    const during = projectEntry(cwd)
    show('projects entry after off (keys)', during ? Object.keys(during) : null)
    show('disabledMcpServers', during?.disabledMcpServers)
    await connection.request('tab.mcpToggle', { tabId: TAB_ID, name: 'tiny', enabled: true })
    await until(async () => (await refresh(), tiny()?.status === 'connected'), 20_000)
    show('  tiny after on', tiny())
    check(tiny()?.status === 'connected', 'stdio server connected again after toggle on')
    const after = projectEntry(cwd)
    show('projects entry after on (keys)', after ? Object.keys(after) : null)
    show('disabledMcpServers', after?.disabledMcpServers)

    console.log('\n== 4. tab.mcpReconnect')
    await connection.request('tab.mcpReconnect', { tabId: TAB_ID, name: 'tiny' })
    await until(async () => (await refresh(), tiny()?.status === 'connected'), 20_000)
    check(tiny()?.status === 'connected', 'stdio server connected after reconnect')

    console.log('\n== 5. tab.mcpAuth / mcpAuthCallback / mcpClearAuth')
    const auth = await connection.request('tab.mcpAuth', { tabId: TAB_ID, name: 'fake' }).catch((error: unknown) => void console.log(`  mcpAuth refused: ${String(error)}`))
    if (auth) {
      const url = new URL(auth.authUrl)
      console.log(`  authUrl host=${url.host} path=${url.pathname} params=${[...url.searchParams.keys()].join(',')} callbackExpected=${auth.callbackExpected}`)
      check(url.host === new URL(oauth.base).host, 'authUrl points at the fake authorization server')
      const redirect = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      if (redirect && state) {
        const callback = new URL(redirect)
        callback.searchParams.set('error', 'access_denied')
        callback.searchParams.set('state', state)
        const outcome = await connection.request('tab.mcpAuthCallback', { tabId: TAB_ID, name: 'fake', url: callback.toString() }).then(
          () => 'accepted',
          (error: unknown) => `refused: ${String(error)}`
        )
        console.log(`  mcpAuthCallback (error=access_denied): ${outcome}`)
        show('  fake after callback', (await refresh()).find((server) => server.name === 'fake'))
      } else console.log('  no redirect_uri/state in authUrl: callback not tried')
    } else problems.push('tab.mcpAuth failed (OAuth part)')
    const cleared = await connection.request('tab.mcpClearAuth', { tabId: TAB_ID, name: 'fake' }).then(
      () => 'ok',
      (error: unknown) => `refused: ${String(error)}`
    )
    console.log(`  mcpClearAuth: ${cleared}`)
    check(cleared === 'ok', 'mcpClearAuth answers')

    console.log('\n== 6. tab.hooks')
    let hooks = await connection.request('tab.hooks', { tabId: TAB_ID })
    for (const hook of hooks.listing.hooks) console.log(`  ${hook.event} | matcher=${hook.matcher ?? '-'} | ${hook.source} | ${hook.type} | ${hook.commandText ?? '-'}`)
    show('policy/safeMode', { policy: hooks.listing.policy, safeMode: hooks.listing.safeMode })
    check(hooks.listing.hooks.some((hook) => hook.event === 'SessionStart' && hook.commandText?.includes('hello-hook')), 'listing has the SessionStart hook')
    check(hooks.listing.hooks.some((hook) => hook.event === 'PreToolUse'), 'listing has the PreToolUse hook')
    await until(async () => (hooks = await connection.request('tab.hooks', { tabId: TAB_ID })).runs.length > 0, 5000)
    for (const run of hooks.runs) show('  run', { event: run.event, name: run.name, outcome: run.outcome, exitCode: run.exitCode, stdout: run.stdout })
    check(hooks.runs.some((run) => run.event === 'SessionStart' && run.stdout?.includes('hello-hook')), 'the SessionStart hook_response arrived with hello-hook')

    console.log('\n== 7. tab.permissions / permissionRule / permissionDirectory (temp folder files only)')
    const rulesOf = async () => (await connection.request('tab.permissions', { tabId: TAB_ID })).rules
    let permissions = await connection.request('tab.permissions', { tabId: TAB_ID })
    show('permissions', permissions)
    check(permissions.cwd === realpathSync(cwd), 'permissions cwd is the session folder')
    await connection.request('tab.permissionRule', { tabId: TAB_ID, op: 'add', behavior: 'allow', rule: 'Bash(git status:*)', destination: 'localSettings' })
    await connection.request('tab.permissionRule', { tabId: TAB_ID, op: 'add', behavior: 'deny', rule: 'Read(./secret.txt)', destination: 'projectSettings' })
    const added = await rulesOf()
    show('  rules after add', added)
    const allowed = added.find((rule) => rule.rule === 'Bash(git status:*)')
    check(allowed?.behavior === 'allow' && allowed.source === 'localSettings' && allowed.editable === 'persistent', 'the live session lists the added local allow rule at once')
    check(Boolean(allowed?.description?.prefix), 'the added rule has the CLI plain-language reading')
    check(added.some((rule) => rule.behavior === 'deny' && rule.source === 'projectSettings' && rule.rule === 'Read(./secret.txt)'), 'the live session lists the added project deny rule')
    const project = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) as Record<string, unknown>
    check(Boolean(project.hooks), 'the project settings file keeps its hooks')
    mkdirSync(join(cwd, 'extra'))
    await connection.request('tab.permissionDirectory', { tabId: TAB_ID, op: 'add', path: 'extra', destination: 'localSettings' })
    permissions = await connection.request('tab.permissions', { tabId: TAB_ID })
    show('  directories after add', permissions.directories)
    check(permissions.directories.some((folder) => folder.path === join(realpathSync(cwd), 'extra')), 'the live session lists the added folder')
    await connection.request('tab.permissionRule', { tabId: TAB_ID, op: 'remove', behavior: 'allow', rule: 'Bash(git status:*)', destination: 'localSettings' })
    await connection.request('tab.permissionRule', { tabId: TAB_ID, op: 'remove', behavior: 'deny', rule: 'Read(./secret.txt)', destination: 'projectSettings' })
    await connection.request('tab.permissionDirectory', { tabId: TAB_ID, op: 'remove', path: join(realpathSync(cwd), 'extra'), destination: 'localSettings' })
    permissions = await connection.request('tab.permissions', { tabId: TAB_ID })
    check(!permissions.rules.some((rule) => rule.rule === 'Bash(git status:*)' || rule.rule === 'Read(./secret.txt)'), 'the removed rules are gone from the live session')
    check(!permissions.directories.some((folder) => folder.path.endsWith('/extra')), 'the removed folder is gone from the live session')

    console.log('\n== 8. raw answers')
    const rawStatus = (await raw.getStatus().catch((error: unknown) => ({ failed: String(error) }))) as Record<string, unknown>
    console.log(`  getStatus top-level keys: ${Object.keys(rawStatus).join(',')}`)
    const rawSections = rawStatus.sections as { rows?: unknown[] }[] | undefined
    show('  getStatus first section', rawSections?.[0])
    const rawHooks = (await raw.getHooksListing().catch((error: unknown) => ({ failed: String(error) }))) as Record<string, unknown>
    console.log(`  getHooksListing top-level keys: ${Object.keys(rawHooks).join(',')}`)
    show('  getHooksListing first hook', (rawHooks.hooks as unknown[] | undefined)?.[0])
  } finally {
    // Leave ~/.claude.json as found: the stdio server is enabled again (above); the temp folder's entry is the CLI's.
    await core.closeAll().catch(() => undefined)
    oauth.server.close()
    rmSync(cwd, { recursive: true, force: true })
  }
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join('\n- ')}` : 'OK: the inspect commands answer from the real CLI and pass the protocol')
  process.exit(problems.length ? 1 : 0)
}

void main().catch((error: unknown) => {
  console.error(`smoke:inspect crashed: ${String(error)}`)
  process.exit(1)
})

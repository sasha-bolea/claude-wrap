import type { Query, ResolvedSettings, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { INSPECT_LIMITS, PERMISSION_BEHAVIORS, type HookEntry, type HookRun, type Hooks, type McpServer, type Memory, type PermissionRule, type Permissions, type Status } from '@athome/protocol'
import { CoreError, messageOf } from './errors.ts'

// Data for the Status / MCP servers / Hooks / Permissions panels. Typed SDK methods are used as they are; the
// runtime-only ones (getStatus, getHooksListing, mcpAuthenticate, mcpSubmitOAuthCallbackUrl, mcpClearAuth,
// listPermissionRules, getMemoryDialog, getSettings: present in sdk.mjs, missing from sdk.d.ts) stay behind the casts in this file and are covered by
// the zero-token smoke.

// The Query methods the SDK ships without types.
type RuntimeMethods = {
  getStatus(): Promise<unknown>
  getHooksListing(): Promise<unknown>
  mcpAuthenticate(name: string, redirectUri?: string): Promise<unknown>
  mcpSubmitOAuthCallbackUrl(name: string, url: string): Promise<unknown>
  mcpClearAuth(name: string): Promise<unknown>
  listPermissionRules(): Promise<unknown>
  getMemoryDialog(): Promise<unknown>
  getSettings(): Promise<unknown>
}

// What the init message told, for the status panel when the CLI cannot report it (see readStatus).
export type InitInfo = { version?: string; model?: string; cwd?: string; permissionMode?: string }

// Settings file resolver (the SDK's resolveSettings), absent in an SDK that lacks it.
export type SettingsResolver = (() => Promise<ResolvedSettings>) | undefined

// Shortens untrusted text to a limit.
function cap(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text
}

// A value of unknown type as display text (objects as JSON, null/undefined as empty).
function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

// Calls a runtime-only Query method; an SDK without it answers like a CLI that refuses: "not available".
function runtime<K extends keyof RuntimeMethods>(query: Query, method: K, ...args: Parameters<RuntimeMethods[K]>): Promise<unknown> {
  const fn = (query as unknown as Partial<RuntimeMethods>)[method] as ((...a: unknown[]) => Promise<unknown>) | undefined
  if (typeof fn !== 'function') return Promise.reject(new Error(`${method} is not available in this SDK`))
  return fn.apply(query, args)
}

// A status row in any shape the CLI may use ({label,value}, {key|name,value}, [label,value], "label: value").
function toRow(row: unknown): { label: string; value: string } | undefined {
  if (typeof row === 'string') {
    const at = row.indexOf(':')
    return at < 0 ? { label: '', value: cap(row, INSPECT_LIMITS.text) } : { label: cap(row.slice(0, at).trim(), INSPECT_LIMITS.name), value: cap(row.slice(at + 1).trim(), INSPECT_LIMITS.text) }
  }
  if (Array.isArray(row)) return { label: cap(textOf(row[0]), INSPECT_LIMITS.name), value: cap(row.slice(1).map(textOf).join(' '), INSPECT_LIMITS.text) }
  if (row && typeof row === 'object') {
    const { label, key, name, value, text } = row as Record<string, unknown>
    return { label: cap(textOf(label ?? key ?? name), INSPECT_LIMITS.name), value: cap(textOf(value ?? text), INSPECT_LIMITS.text) }
  }
  return undefined
}

// The sections of a get_status answer, rows normalized to {label, value}; anything unrecognized is dropped.
export function toSections(answer: unknown): Status['sections'] {
  const sections = (answer as { sections?: unknown } | null)?.sections
  if (!Array.isArray(sections)) throw new Error('get_status answered without sections')
  return sections.map((section: { title?: unknown; rows?: unknown }) => ({
    title: cap(textOf(section?.title), INSPECT_LIMITS.name),
    rows: (Array.isArray(section?.rows) ? section.rows : []).map(toRow).filter((row): row is { label: string; value: string } => row !== undefined)
  }))
}

// Sections built from what the init message and accountInfo() tell (a CLI without get_status).
async function fallbackSections(query: Query, init: InitInfo): Promise<Status['sections']> {
  const account = await query.accountInfo().catch(() => undefined)
  const pairs: [string, string | undefined][] = [
    ['Version', init.version],
    ['Model', init.model],
    ['Working directory', init.cwd],
    ['Permission mode', init.permissionMode]
  ]
  const accountPairs: [string, string | undefined][] = [
    ['Email', account?.email],
    ['Organization', account?.organization],
    ['Plan', account?.subscriptionType],
    ['Login', account?.tokenSource ?? account?.apiKeySource],
    ['Provider', account?.apiProvider]
  ]
  const rows = (list: [string, string | undefined][]) => list.filter(([, value]) => value).map(([label, value]) => ({ label, value: cap(value!, INSPECT_LIMITS.text) }))
  return [{ title: 'Session', rows: rows(pairs) }, { title: 'Account', rows: rows(accountPairs) }].filter((section) => section.rows.length > 0)
}

// The settings files in effect (source and path), none when the SDK cannot resolve them or fails.
async function settingsFiles(resolve: SettingsResolver): Promise<Status['settingsFiles']> {
  const resolved = await resolve?.().catch(() => undefined)
  return (resolved?.sources ?? []).filter((entry) => entry.path).map((entry) => ({ source: cap(entry.source, INSPECT_LIMITS.name), path: cap(entry.path!, INSPECT_LIMITS.text) }))
}

// Whether a failure only says the CLI does not know the request (so the fallback may answer instead).
function isUnavailable(error: unknown): boolean {
  return /not available|not supported|unsupported|unknown (control )?request|unknown subtype/i.test(messageOf(error))
}

// The /status panel: the CLI's own sections, else the fallback; other failures are thrown.
export async function readStatus(query: Query, init: InitInfo, resolve: SettingsResolver): Promise<Status> {
  const sections = await runtime(query, 'getStatus').then(toSections, async (error: unknown) => {
    if (!isUnavailable(error)) throw error
    return fallbackSections(query, init)
  })
  return { sections, settingsFiles: await settingsFiles(resolve) }
}

// The MCP servers with their state; tools only counted, the URL of HTTP/SSE servers kept (credentials stay out: no headers).
export async function readMcp(query: Query): Promise<{ servers: McpServer[] }> {
  const list = await query.mcpServerStatus()
  return {
    servers: list.map((server) => {
      const url = (server.config as { url?: unknown } | undefined)?.url
      return {
        name: cap(server.name, INSPECT_LIMITS.name),
        status: server.status,
        ...(server.error ? { error: cap(server.error, INSPECT_LIMITS.text) } : {}),
        ...(server.scope ? { scope: cap(server.scope, INSPECT_LIMITS.name) } : {}),
        ...(server.source ? { source: cap(server.source, INSPECT_LIMITS.name) } : {}),
        tools: server.tools?.length ?? 0,
        ...(typeof url === 'string' ? { url: cap(url, INSPECT_LIMITS.text) } : {})
      }
    })
  }
}

// Whether text is an http(s) URL (the only schemes a sign-in page or a callback may have).
function isWebUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

// Starts the sign-in of an MCP server. Returns the page to open; refused (invalid_args) when the CLI sends no http(s) address.
export async function startMcpAuth(query: Query, name: string): Promise<{ authUrl: string; callbackExpected: boolean }> {
  const answer = (await runtime(query, 'mcpAuthenticate', name)) as { authUrl?: unknown; callbackExpected?: unknown } | null
  const authUrl = answer?.authUrl
  if (typeof authUrl !== 'string' || authUrl.length > INSPECT_LIMITS.url || !isWebUrl(authUrl)) throw new CoreError('invalid_args', 'the sign-in address is not an http(s) URL')
  return { authUrl, callbackExpected: answer?.callbackExpected === true }
}

// Hands the redirect URL of a sign-in to the CLI (the code or error inside is the CLI's to check).
export async function submitMcpCallback(query: Query, name: string, url: string): Promise<void> {
  if (url.length > INSPECT_LIMITS.url || !isWebUrl(url)) throw new CoreError('invalid_args', 'the callback is not an http(s) URL')
  await runtime(query, 'mcpSubmitOAuthCallbackUrl', name, url)
}

// Forgets the stored sign-in of an MCP server.
export async function clearMcpAuth(query: Query, name: string): Promise<void> {
  await runtime(query, 'mcpClearAuth', name)
}

// The hooks listing (display-ready strings from the CLI) reduced to what the panel shows.
export async function readHookListing(query: Query): Promise<Hooks['listing']> {
  const answer = (await runtime(query, 'getHooksListing')) as { hooks?: unknown; policy?: Record<string, unknown>; safeMode?: { exitHint?: unknown } } | null
  if (!answer || !Array.isArray(answer.hooks)) throw new Error('get_hooks_listing answered without hooks')
  const hooks = answer.hooks.map((hook: Record<string, unknown>): HookEntry => ({
    event: cap(textOf(hook.event), INSPECT_LIMITS.name),
    ...(hook.matcher ? { matcher: cap(textOf(hook.matcher), INSPECT_LIMITS.text) } : {}),
    source: cap(textOf(hook.source), INSPECT_LIMITS.name),
    ...(hook.sourceLabel ? { sourceLabel: cap(textOf(hook.sourceLabel), INSPECT_LIMITS.text) } : {}),
    type: cap(textOf(hook.type), INSPECT_LIMITS.name),
    ...(hook.commandText ? { commandText: cap(textOf(hook.commandText), INSPECT_LIMITS.text) } : {}),
    ...(typeof hook.timeout === 'number' ? { timeout: hook.timeout } : {}),
    ...(hook.disabled ? { disabled: true } : {})
  }))
  const { policy, safeMode } = answer
  return {
    hooks,
    ...(policy ? { policy: { allDisabled: policy.allDisabled === true, managedOnly: policy.managedOnly === true, disabledByPolicy: policy.disabledByPolicy === true, pluginOnly: policy.pluginOnly === true } } : {}),
    ...(safeMode ? { safeMode: typeof safeMode.exitHint === 'string' ? { exitHint: cap(safeMode.exitHint, INSPECT_LIMITS.text) } : {} } : {})
  }
}

// One rule of a list_permission_rules answer as the panel shows it; an unknown behavior or editability drops the rule.
function toRule(entry: Record<string, unknown>): PermissionRule | undefined {
  const { behavior, editability, description } = entry
  if (!PERMISSION_BEHAVIORS.includes(behavior as PermissionRule['behavior'])) return undefined
  if (editability !== 'persistent' && editability !== 'session' && editability !== 'readonly') return undefined
  const words = description && typeof description === 'object' ? (description as Record<string, unknown>) : undefined
  return {
    behavior: behavior as PermissionRule['behavior'],
    source: cap(textOf(entry.source), INSPECT_LIMITS.name),
    rule: cap(textOf(entry.rule), INSPECT_LIMITS.text),
    ...(words ? { description: { prefix: cap(textOf(words.prefix), INSPECT_LIMITS.text), ...(words.emphasis ? { emphasis: cap(textOf(words.emphasis), INSPECT_LIMITS.text) } : {}), ...(words.suffix ? { suffix: cap(textOf(words.suffix), INSPECT_LIMITS.text) } : {}) } } : {}),
    editable: editability,
    ...(entry.notInEffect === true ? { notInEffect: true } : {})
  }
}

// The session's live permission rules and extra working folders (as /permissions lists them).
export async function readPermissions(query: Query): Promise<Permissions> {
  const answer = (await runtime(query, 'listPermissionRules')) as { state?: Record<string, unknown> } | null
  const state = answer?.state
  if (!state || !Array.isArray(state.rules)) throw new Error('list_permission_rules answered without rules')
  const folders = Array.isArray(state.workspaceDirectories) ? (state.workspaceDirectories as Record<string, unknown>[]) : []
  return {
    rules: state.rules.map((entry) => (entry && typeof entry === 'object' ? toRule(entry as Record<string, unknown>) : undefined)).filter((rule): rule is PermissionRule => rule !== undefined),
    directories: folders.map((folder) => ({ path: cap(textOf(folder.path), INSPECT_LIMITS.text), source: cap(textOf(folder.source), INSPECT_LIMITS.name) })),
    cwd: cap(textOf(state.originalCwd), INSPECT_LIMITS.text),
    managedOnly: state.managedOnly === true
  }
}

// The paths a get_memory_dialog answer lists: instruction files and saved memories (what the Memory panel may open).
export type MemoryPaths = { files: string[]; memories: string[] }

// The CLI's memory dialog as raw records (files, folders, memories); throws when it answers without files.
async function memoryDialog(query: Query): Promise<{ files: Record<string, unknown>[]; folders: Record<string, unknown>[]; memories: Record<string, unknown>[] }> {
  const answer = (await runtime(query, 'getMemoryDialog')) as Record<string, unknown> | null
  if (!answer || !Array.isArray(answer.files)) throw new Error('get_memory_dialog answered without files')
  const records = (list: unknown) => (Array.isArray(list) ? list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : [])
  return { files: records(answer.files), folders: records(answer.folders), memories: records(answer.memories) }
}

// The paths the memory dialog lists now.
export async function readMemoryPaths(query: Query): Promise<MemoryPaths> {
  const dialog = await memoryDialog(query)
  return { files: dialog.files.map((file) => textOf(file.path)), memories: dialog.memories.map((memory) => textOf(memory.path)) }
}

// /memory as the panel shows it: instruction files, the auto-memory folder, saved memories, and whether auto memory is
// on (the session's effective autoMemoryEnabled; absent = on, Claude Code's default).
export async function readMemory(query: Query): Promise<Memory> {
  const dialog = await memoryDialog(query)
  const settings = (await runtime(query, 'getSettings')) as { effective?: Record<string, unknown> } | null
  const folder = dialog.folders.find((entry) => entry.kind === 'auto')?.path
  return {
    files: dialog.files.map((file) => ({
      kind: cap(textOf(file.kind), INSPECT_LIMITS.name),
      path: cap(textOf(file.path), INSPECT_LIMITS.text),
      label: cap(textOf(file.label), INSPECT_LIMITS.text),
      description: cap(textOf(file.description), INSPECT_LIMITS.text),
      exists: file.exists === true
    })),
    ...(typeof folder === 'string' ? { folder: cap(folder, INSPECT_LIMITS.text) } : {}),
    memories: dialog.memories.map((memory) => ({
      name: cap(textOf(memory.name), INSPECT_LIMITS.text),
      path: cap(textOf(memory.path), INSPECT_LIMITS.text),
      description: cap(textOf(memory.description), INSPECT_LIMITS.text),
      ...(typeof memory.type === 'string' && memory.type ? { type: cap(memory.type, INSPECT_LIMITS.name) } : {}),
      ...(typeof memory.modified_ms === 'number' ? { modifiedAt: memory.modified_ms } : {})
    })),
    autoMemory: settings?.effective?.autoMemoryEnabled !== false
  }
}

// The last hook runs of a tab, from hook_response messages (hook_started only tells a run began: nothing is kept).
// Lives as long as the tab: a process restart keeps it.
export class HookRuns {
  private readonly runs: HookRun[] = []

  // Records a hook_response message; any other message is ignored. now: the time of the run (ms).
  add(message: SDKMessage, now = Date.now()): void {
    if (message.type !== 'system' || message.subtype !== 'hook_response') return
    const { hook_event: event, hook_name: name, outcome, exit_code: exitCode, stdout, stderr } = message
    this.runs.push({
      at: now,
      event: cap(event, INSPECT_LIMITS.name),
      name: cap(name, INSPECT_LIMITS.text),
      outcome,
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
      ...(stdout ? { stdout: cap(stdout, INSPECT_LIMITS.output) } : {}),
      ...(stderr ? { stderr: cap(stderr, INSPECT_LIMITS.output) } : {})
    })
    if (this.runs.length > INSPECT_LIMITS.hooks) this.runs.splice(0, this.runs.length - INSPECT_LIMITS.hooks)
  }

  // The runs, oldest first.
  list(): HookRun[] {
    return [...this.runs]
  }
}

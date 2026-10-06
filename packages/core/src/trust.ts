// Folder trust (port of the first attempt's fiducia.ts, extended). SDK sessions never show the CLI's trust
// dialog — in SDK mode the CLI accepts it on its own — so without this gate, opening an unknown repo would run
// its hooks, env and MCP servers without asking. Rules replicate the CLI (2.1.285+).
import { access, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import type { ProjectConfig } from '@athome/protocol'

export type CliProjects = Record<string, { hasTrustDialogAccepted?: boolean }>

const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json']
// Settings that run a command for credentials or telemetry.
const HELPERS = ['apiKeyHelper', 'proxyAuthHelper', 'otelHeadersHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh'] as const
// Other top-level settings that run commands, relax security or auto-approve MCP servers: shown with their value.
const RISKY_SETTINGS = [
  'fileSuggestion',
  'statusLine',
  'subagentStatusLine',
  'sandbox',
  'worktree',
  'allowedHttpHookUrls',
  'httpHookAllowedEnvVars',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers'
] as const
// Every top-level key of the SDK `Settings` type whose subtree mentions command/helper/url/path/hook must be
// classified here or above. The probe (`npm run probe`) fails when the SDK adds an unclassified one.
// Reviewed and not shown: managed-only (policyHelper, forceLoginGatewayUrl, allowedMcpServers, deniedMcpServers,
// strict/allowed/blockedMarketplaces, disableCommandPluginSources), restrictive (disableAllHooks,
// allowManagedHooksOnly), ignored in project files (footerLinksRegexes) or harmless (attribution,
// respondToBashCommands, prUrlTemplate).
export const CLASSIFIED_SETTINGS: readonly string[] = [
  ...HELPERS,
  ...RISKY_SETTINGS,
  'hooks',
  'extraKnownMarketplaces',
  'additionalMarketplaces',
  'policyHelper',
  'forceLoginGatewayUrl',
  'allowedMcpServers',
  'deniedMcpServers',
  'strictKnownMarketplaces',
  'allowedMarketplaces',
  'blockedMarketplaces',
  'disableCommandPluginSources',
  'disableAllHooks',
  'allowManagedHooksOnly',
  'footerLinksRegexes',
  'attribution',
  'respondToBashCommands',
  'prUrlTemplate'
]
// Default modes that skip prompts.
const RISKY_DEFAULT_MODES = ['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']

type Hook = { matcher?: string; hooks?: { type?: string; command?: string; url?: string }[] }
type Marketplace = { source?: { headersHelper?: string } }
type Settings = Record<string, unknown> & {
  hooks?: Record<string, Hook[]>
  permissions?: { allow?: string[]; defaultMode?: string; additionalDirectories?: string[] }
  env?: Record<string, string>
  autoMemoryDirectory?: string
  enabledPlugins?: Record<string, unknown>
  extraKnownMarketplaces?: Record<string, Marketplace>
  additionalMarketplaces?: Record<string, Marketplace>
}
type McpServer = { command?: string; args?: string[]; url?: string; headersHelper?: string }

// Removes the long-path prefix of Windows (\\?\C:\... and \\?\UNC\server\...): same folder, other spelling.
function stripLongPrefix(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
}

// Comparable path: no \\?\ prefix, '/' separators, no trailing '/', lower case on Windows.
function normalize(path: string): string {
  const slashed = stripLongPrefix(path).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

// The folder and its ancestors, nearest first; stops at `upTo` (included) if met, else at the drive root.
function ancestors(path: string, upTo?: string): string[] {
  const limit = upTo && normalize(resolve(upTo))
  const list: string[] = []
  for (let current = resolve(stripLongPrefix(path)); ; current = dirname(current)) {
    list.push(current)
    if (normalize(current) === limit || dirname(current) === current) return list
  }
}

// True if the folder or an ancestor is trusted, in the app or in the CLI. Inside a git repo the search stops at
// the repo root: a repo cloned under a trusted folder does NOT inherit the trust (like the CLI).
// sessionOnly: exact folders trusted for this run only (home, roots…), not their subfolders.
export function isTrusted(cwd: string, trusted: string[], cliProjects: CliProjects, gitRoot?: string, sessionOnly: string[] = []): boolean {
  const accepted = new Set(
    [...trusted, ...Object.entries(cliProjects).filter(([, project]) => project.hasTrustDialogAccepted).map(([path]) => path)].map(normalize)
  )
  if (sessionOnly.map(normalize).includes(normalize(resolve(stripLongPrefix(cwd))))) return true
  return ancestors(cwd, gitRoot).some((path) => accepted.has(normalize(path)))
}

// True for the home, its ancestors (e.g. C:\Users) and drive roots: trusting them for good would trust thousands of folders.
export function tooBroad(path: string, home = homedir()): boolean {
  const absolute = resolve(stripLongPrefix(path))
  const normalized = normalize(absolute)
  const homeNormalized = normalize(resolve(stripLongPrefix(home)))
  return normalized === normalize(parse(absolute).root) || normalized === homeNormalized || homeNormalized.startsWith(normalized + '/')
}

// Where an accepted trust applies: the git root (or the folder). Too broad (home, ancestors, roots; also a home
// that is a dotfiles repo) → only the opened folder, for this run only.
export function trustScope(cwd: string, gitRoot: string | undefined, home = homedir()): { path: string; sessionOnly: boolean } {
  const target = gitRoot ?? cwd
  return tooBroad(target, home) ? { path: cwd, sessionOnly: true } : { path: target, sessionOnly: false }
}

const exists = (path: string) => access(path).then(() => true, () => false)

// Root of the git repo containing the folder (first ancestor with .git, folder or worktree file).
export async function findGitRoot(cwd: string): Promise<string | undefined> {
  for (const path of ancestors(cwd)) if (await exists(join(path, '.git'))) return path
  return undefined
}

// Reads the "projects" section of ~/.claude.json (read only: the file belongs to the CLI). A concurrent CLI
// write can leave it half written for a moment: one retry, then empty.
export async function readCliProjects(file = join(homedir(), '.claude.json')): Promise<CliProjects> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (JSON.parse(await readFile(file, 'utf8')) as { projects?: CliProjects }).projects ?? {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return {}
}

// Reads a JSON file: undefined if missing, 'invalid' if unreadable as JSON. A leading UTF-8 BOM is ignored, like the CLI.
async function readJson<T>(path: string): Promise<T | 'invalid' | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T
  } catch {
    return 'invalid'
  }
}

// Hooks of a settings file as readable lines "Event (matcher): command".
function describeHooks(settings: Settings): string[] {
  return Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((group) => (group.hooks ?? []).map((hook) => `${event}${group.matcher ? ` (${group.matcher})` : ''}: ${hook.command ?? hook.url ?? hook.type}`))
  )
}

// Marketplaces declared by a settings file, with their headers helper if any.
function describeMarketplaces(key: string, marketplaces: Record<string, Marketplace> | undefined): string[] {
  return Object.entries(marketplaces ?? {}).map(([name, market]) => `${key}: ${name}${market?.source?.headersHelper ? ` (headersHelper: ${market.source.headersHelper})` : ''}`)
}

// Settings that run commands, change where data goes (env), bring third-party code or skip prompts.
function describeRisks(settings: Settings): string[] {
  const value = (key: string) => (typeof settings[key] === 'string' ? (settings[key] as string) : JSON.stringify(settings[key]))
  const defaultMode = settings.permissions?.defaultMode
  return [
    ...(defaultMode && RISKY_DEFAULT_MODES.includes(defaultMode) ? [`permissions.defaultMode: ${defaultMode}`] : []),
    ...Object.entries(settings.env ?? {}).map(([key, envValue]) => `env ${key}=${envValue}`),
    ...HELPERS.filter((key) => settings[key]).map((key) => `${key}: ${value(key)}`),
    ...(settings.autoMemoryDirectory ? [`autoMemoryDirectory: ${settings.autoMemoryDirectory}`] : []),
    ...Object.entries(settings.enabledPlugins ?? {}).filter(([, enabled]) => enabled).map(([plugin]) => `enabledPlugins: ${plugin}`),
    ...describeMarketplaces('extraKnownMarketplaces', settings.extraKnownMarketplaces),
    ...describeMarketplaces('additionalMarketplaces', settings.additionalMarketplaces),
    ...RISKY_SETTINGS.filter((key) => settings[key] !== undefined && settings[key] !== false).map((key) => `${key}: ${value(key)}`)
  ]
}

// Adds a project settings file to the result.
async function analyzeSettings(cwd: string, name: string, result: ProjectConfig): Promise<void> {
  const settings = await readJson<Settings>(join(cwd, name))
  if (settings === undefined) return
  if (settings === 'invalid') return void result.files.push(`${name} (invalid JSON)`)
  result.files.push(name)
  result.hooks.push(...describeHooks(settings))
  const permissions = settings.permissions ?? {}
  result.permissions.push(...(permissions.allow ?? []).map((rule) => `allow ${rule}`))
  if (permissions.defaultMode) result.permissions.push(`defaultMode ${permissions.defaultMode}`)
  result.permissions.push(...(permissions.additionalDirectories ?? []).map((folder) => `additionalDirectories ${folder}`))
  result.risks.push(...describeRisks(settings))
}

// Adds the servers of a .mcp.json, with the file they come from.
async function analyzeMcp(path: string, result: ProjectConfig): Promise<void> {
  const mcp = await readJson<{ mcpServers?: Record<string, McpServer> }>(path)
  if (mcp === undefined) return
  if (mcp === 'invalid') return void result.files.push(`${path} (invalid JSON)`)
  result.files.push(path)
  result.mcp.push(
    ...Object.entries(mcp.mcpServers ?? {}).map(
      ([name, server]) => `${name}: ${server.url ?? [server.command, ...(server.args ?? [])].join(' ')}${server.headersHelper ? `, headersHelper: ${server.headersHelper}` : ''} (${path})`
    )
  )
}

// Dangerous frontmatter of a command, skill or agent file: Bash pre-approval, permission mode, MCP servers, hooks.
async function frontmatterFindings(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8').catch(() => '')
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter)?.[1]?.trim()
  const tools = field('allowed-tools')
  const findings: string[] = []
  if (tools?.includes('Bash')) findings.push(`pre-approves ${tools}`)
  if (field('permissionMode')) findings.push(`permissionMode ${field('permissionMode')}`)
  if (field('mcpServers') !== undefined) findings.push('mcpServers')
  if (field('hooks') !== undefined) findings.push('hooks')
  return findings
}

// Project commands (any depth), skills (SKILL.md at any depth) and agents whose frontmatter runs or approves things.
async function analyzeFrontmatter(cwd: string, result: ProjectConfig): Promise<void> {
  const sources = [
    { kind: 'command', folder: '.claude/commands', matches: (name: string) => name.endsWith('.md') },
    { kind: 'skill', folder: '.claude/skills', matches: (name: string) => /(^|[\\/])SKILL\.md$/.test(name) },
    { kind: 'agent', folder: '.claude/agents', matches: (name: string) => name.endsWith('.md') }
  ]
  for (const { kind, folder, matches } of sources) {
    const names = await readdir(join(cwd, folder), { recursive: true }).catch(() => [] as string[])
    for (const name of names.filter(matches).sort()) {
      const findings = await frontmatterFindings(join(cwd, folder, name))
      if (findings.length) result.risks.push(`${kind} ${folder}/${name.replace(/\\/g, '/')}: ${findings.join('; ')}`)
    }
  }
}

// What opening a session in the folder would load and run: settings, commands/skills/agents, the .mcp.json of
// the folder and of every ancestor (the CLI loads them all), CLAUDE.md.
export async function analyzeProject(cwd: string): Promise<ProjectConfig> {
  const result: ProjectConfig = { hooks: [], mcp: [], permissions: [], risks: [], files: [] }
  for (const name of SETTINGS_FILES) await analyzeSettings(cwd, name, result)
  await analyzeFrontmatter(cwd, result)
  for (const folder of ancestors(cwd)) await analyzeMcp(join(folder, '.mcp.json'), result)
  for (const name of ['CLAUDE.md', '.claude/CLAUDE.md']) if (await exists(join(cwd, name))) result.files.push(name)
  return result
}

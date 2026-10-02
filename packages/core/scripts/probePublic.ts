// The publishable part of an SDK probe: facts and shapes of the SDK, not the probing user's own setup. Their
// agents, skills, plugins, MCP servers, slash commands, account and paths stay in the git-ignored
// docs/reference/sdk-probe.local.json; only built-in commands and agents, field names and counts are kept here.

type Named = { name: string; builtin?: boolean }
type Probe = {
  created?: string
  sdkVersion?: string
  cliVersion?: string
  facts?: unknown
  systemInit?: Record<string, unknown>
  initialization?: Record<string, unknown>
  commands?: Named[]
  models?: unknown
  agents?: Named[]
  firstTurnMessageTypes?: unknown
  secondTurnMessageTypes?: unknown
  silentTurnMessageTypes?: unknown
}

// Agents every CLI ships with (the rest come from the user's or plugins' folders).
const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude'])
const count = (value: unknown) => (Array.isArray(value) ? value.length : undefined)

export function publicProbe(probe: Probe): object {
  const init = probe.systemInit ?? {}
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((key) => key in init).map((key) => [key, init[key]]))
  return {
    created: probe.created,
    sdkVersion: probe.sdkVersion,
    cliVersion: probe.cliVersion,
    facts: probe.facts,
    systemInit: {
      fields: Object.keys(init),
      ...pick(['model', 'permissionMode', 'claude_code_version', 'output_style', 'apiKeySource', 'capabilities', 'terminal_slash_commands', 'fast_mode_state']),
      counts: Object.fromEntries(['tools', 'mcp_servers', 'slash_commands', 'skills', 'agents', 'plugins'].map((key) => [key, count(init[key])]))
    },
    initialization: { fields: Object.keys(probe.initialization ?? {}), capabilities: probe.initialization?.capabilities },
    builtinCommands: (probe.commands ?? []).filter((command) => command.builtin),
    commandCount: count(probe.commands),
    models: probe.models,
    builtinAgents: (probe.agents ?? []).filter((agent) => BUILTIN_AGENTS.has(agent.name)).map((agent) => agent.name),
    firstTurnMessageTypes: probe.firstTurnMessageTypes,
    secondTurnMessageTypes: probe.secondTurnMessageTypes,
    silentTurnMessageTypes: probe.silentTurnMessageTypes
  }
}

// Used by the history clean-up: reads a probe JSON on stdin, prints its public view.
if (process.argv[1]?.endsWith('probePublic.ts')) {
  let input = ''
  process.stdin.setEncoding('utf8').on('data', (chunk: string) => (input += chunk))
  process.stdin.on('end', () => process.stdout.write(JSON.stringify(publicProbe(JSON.parse(input) as Probe), null, 2) + '\n'))
}

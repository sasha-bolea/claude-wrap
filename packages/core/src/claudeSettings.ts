import { CLAUDE_MODELS, type ClaudeSettingChange, type ClaudeSettings } from '@athome/protocol'
import { readSettings, updateSettings } from './settingsFiles.ts'

// Claude Code's /config settings that change Claude in AtHome too, read from and saved to the user's settings file the
// way /config saves them (checked on CLI 2.1.287): each /config name lives at a path of settings.json; some keys are
// removed when set back to their default, others are stored either way.

type Key = keyof ClaudeSettings
type Entry = { path: string[]; fallback: ClaudeSettings[Key]; keepDefault?: boolean; accepts(value: unknown): boolean }

const isBoolean = (value: unknown) => typeof value === 'boolean'
const KEYS: Record<Key, Entry> = {
  model: { path: ['model'], fallback: 'default', accepts: (value) => CLAUDE_MODELS.includes(value as ClaudeSettings['model']) },
  thinking: { path: ['alwaysThinkingEnabled'], fallback: true, accepts: isBoolean },
  language: { path: ['language'], fallback: '', accepts: (value) => typeof value === 'string' && value.length <= 100 },
  autoCompact: { path: ['autoCompactEnabled'], fallback: true, keepDefault: true, accepts: isBoolean },
  useAutoModeDuringPlan: { path: ['useAutoModeDuringPlan'], fallback: true, keepDefault: true, accepts: isBoolean },
  workflows: { path: ['enableWorkflows'], fallback: true, accepts: isBoolean },
  workflowKeywordTriggerEnabled: { path: ['workflowKeywordTriggerEnabled'], fallback: true, accepts: isBoolean },
  worktreeBaseRef: { path: ['worktree', 'baseRef'], fallback: 'fresh', accepts: (value) => value === 'fresh' || value === 'head' }
}

// The value at a path of a settings object (undefined when any step is missing or not an object).
function valueAt(settings: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = settings
  for (const step of path) node = node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>)[step] : undefined
  return node
}

// Reads the /config settings of a user settings file; a missing or wrongly typed value counts as Claude Code's default.
// invalid_args when the file is not a JSON object.
export async function readClaudeSettings(file: string): Promise<ClaudeSettings> {
  const settings = await readSettings(file)
  const values = {} as Record<Key, unknown>
  for (const [key, entry] of Object.entries(KEYS) as [Key, Entry][]) {
    const value = valueAt(settings, entry.path)
    values[key] = entry.accepts(value) ? value : entry.fallback
  }
  return values as ClaudeSettings
}

// Saves one /config setting to a user settings file: the default value removes the key (and a parent object left
// empty) unless /config stores it either way. Returns whether the file changed.
export function saveClaudeSetting(file: string, change: ClaudeSettingChange): Promise<boolean> {
  const entry = KEYS[change.key]
  const value = typeof change.value === 'string' ? change.value.trim() : change.value
  return updateSettings(file, (settings) => {
    const before = JSON.stringify(settings)
    const parents: Record<string, unknown>[] = [settings]
    for (const step of entry.path.slice(0, -1)) {
      const parent = parents.at(-1)!
      const next = parent[step]
      parent[step] = next && typeof next === 'object' && !Array.isArray(next) ? next : {}
      parents.push(parent[step] as Record<string, unknown>)
    }
    const holder = parents.at(-1)!
    const last = entry.path.at(-1)!
    if (value === entry.fallback && !entry.keepDefault) delete holder[last]
    else holder[last] = value
    for (let at = entry.path.length - 1; at > 0; at--) if (Object.keys(parents[at]!).length === 0) delete parents[at - 1]![entry.path[at - 1]!]
    return JSON.stringify(settings) !== before
  })
}

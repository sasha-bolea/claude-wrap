import type { PermissionMode } from '@athome/protocol'
import type { MessageKey } from './i18n/en.ts'

// Selectable permission modes, as in the CLI. bypassPermissions is left out: it only works when the session
// starts with allowDangerouslySkipPermissions.
export const MODES: { value: PermissionMode; label: MessageKey }[] = [
  { value: 'default', label: 'modeDefault' },
  { value: 'acceptEdits', label: 'modeAcceptEdits' },
  { value: 'plan', label: 'modePlan' },
  { value: 'auto', label: 'modeAuto' },
  { value: 'dontAsk', label: 'modeDontAsk' }
]

// Shift+Tab cycle of the CLI prompt.
const CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan']

// Mode after `current` in the Shift+Tab cycle (modes outside the cycle restart it).
export function nextMode(current: PermissionMode): PermissionMode {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]!
}

// Dictionary key of a mode's label.
export const modeLabel = (mode: PermissionMode): MessageKey => MODES.find((entry) => entry.value === mode)?.label ?? 'modeDefault'

import type { SettingsDestination } from '@athome/protocol'
import type { MessageKey } from '../i18n/en.ts'

// Helpers of the Permissions panel: reading untrusted rule text safely, source labels and the settings file of each
// destination.

// The settings file behind each destination, as shown to the user.
export const DESTINATION_FILES: Record<SettingsDestination, string> = {
  localSettings: '.claude/settings.local.json',
  projectSettings: '.claude/settings.json',
  userSettings: '~/.claude/settings.json'
}

// Labels of the sources the CLI reports; any other source is shown raw.
const SOURCE_LABELS: Record<string, MessageKey> = {
  localSettings: 'permSource_localSettings',
  projectSettings: 'permSource_projectSettings',
  userSettings: 'permSource_userSettings',
  session: 'permSource_session',
  cliArg: 'permSource_cliArg',
  policySettings: 'permSource_policySettings',
  flagSettings: 'permSource_flagSettings',
  command: 'permSource_command'
}

// The dictionary key of a source's label, or undefined for a source the app does not know (show it raw).
export function sourceLabelKey(source: string): MessageKey | undefined {
  return Object.hasOwn(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : undefined
}

// The settings file a destination source is saved in; undefined for sources that are not a settings file.
export function destinationOf(source: string): SettingsDestination | undefined {
  return Object.hasOwn(DESTINATION_FILES, source) ? (source as SettingsDestination) : undefined
}

// Makes text safe to read: every invisible, control or unusual space character becomes a visible \u{XXXX} escape, so
// a rule cannot hide what it matches. Plain spaces stay.
// Parameters: the untrusted text. Returns the text with those characters spelled out.
export function visibleText(text: string): string {
  return text.replace(/[\p{C}\p{Z}]/gu, (char) => (char === ' ' ? char : `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`))
}

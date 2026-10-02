import { CLASSIFIED_SETTINGS } from './trust.ts'

// Words that make a settings key worth a look for the trust gate: it may run something or point somewhere.
const RISKY_WORDS = /command|helper|url|path|hook/i

// Top-level keys of the SDK `Settings` interface (from sdk.d.ts) whose name, or the name of any key nested
// under them, contains a risky word.
// ponytail: line-based scan of the declaration (top-level keys at 4 spaces); a real TS parse if the format changes.
export function riskySettingsKeys(sdkDeclarations: string): string[] {
  const lines = sdkDeclarations.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith('export declare interface Settings {'))
  if (start < 0) throw new Error('Settings interface not found in sdk.d.ts')
  const risky = new Set<string>()
  let current: string | undefined
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('}')) break
    const top = /^ {4}'?([A-Za-z_$][\w$]*)'?\??:/.exec(line)
    if (top) current = top[1]
    const nested = /^\s+'?([A-Za-z_$][\w$]*)'?\??:/.exec(line)
    if (current && nested && RISKY_WORDS.test(nested[1]!)) risky.add(current)
  }
  return [...risky]
}

// Risky keys the trust gate has not classified yet (the probe fails on any).
export function unclassifiedSettings(sdkDeclarations: string): string[] {
  return riskySettingsKeys(sdkDeclarations).filter((key) => !CLASSIFIED_SETTINGS.includes(key))
}

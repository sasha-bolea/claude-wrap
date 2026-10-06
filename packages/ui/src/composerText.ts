import type { SlashCommand } from '@athome/protocol'

// Pure text logic of the composer: suggestion triggers (`/` commands, `@` files) and long-paste placeholders.

// What the user is completing: a command (`/name` as the first word) or a file (`@path`), and where it sits.
export type Trigger = { kind: 'command' | 'file'; query: string; start: number; end: number }

// Pastes longer than this become a placeholder in the composer, like the CLI's "[Pasted text #1 +N lines]".
const LONG_PASTE_CHARS = 1000
const LONG_PASTE_LINES = 10

// The trigger that ends at the caret, if any.
export function triggerAt(text: string, caret: number): Trigger | undefined {
  const before = text.slice(0, caret)
  const command = /^\/(\S*)$/.exec(before)
  if (command) return { kind: 'command', query: command[1]!, start: 0, end: caret }
  const file = /(?:^|\s)@(\S*)$/.exec(before)
  if (file) return { kind: 'file', query: file[1]!, start: caret - file[1]!.length - 1, end: caret }
  return undefined
}

// Replaces the trigger with the chosen text plus a space (none after a folder: the user goes on into it).
// Returns the new text and where the caret goes.
export function applySuggestion(text: string, trigger: Trigger, replacement: string): { text: string; caret: number } {
  const inserted = replacement.endsWith('/') ? replacement : `${replacement} `
  return { text: text.slice(0, trigger.start) + inserted + text.slice(trigger.end), caret: trigger.start + inserted.length }
}

// An `@` mention as the CLI reads it (quoted when the path has spaces).
// True when the caret is on the first (Up) or last (Down) line of the field, with nothing selected.
export function caretOnEdgeLine(field: HTMLTextAreaElement, edge: 'first' | 'last'): boolean {
  if (field.selectionStart !== field.selectionEnd) return false
  return edge === 'first' ? !field.value.slice(0, field.selectionStart).includes('\n') : !field.value.slice(field.selectionEnd).includes('\n')
}

export const mention = (path: string) => (/\s/.test(path) ? `@"${path}"` : `@${path}`)

// Commands matching a query: name prefix first, then name or description containing it.
export function matchCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase()
  const rank = (command: SlashCommand) => {
    if (command.name.toLowerCase().startsWith(needle)) return 0
    if (command.name.toLowerCase().includes(needle) || command.description.toLowerCase().includes(needle)) return 1
    return -1
  }
  return commands
    .map((command) => ({ command, score: rank(command) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score)
    .map(({ command }) => command)
}

export const isLongPaste = (text: string) => text.length > LONG_PASTE_CHARS || text.split('\n').length > LONG_PASTE_LINES

// The placeholder of paste number id, in the CLI's format (its history stores the same).
export const pastePlaceholder = (id: number, text: string) => `[Pasted text #${id} +${text.split('\n').length - 1} lines]`

// The text to send, with every placeholder still present replaced by its paste, and those pastes in order.
export function expandPastes(text: string, pastes: Record<number, string>): { text: string; pastes: string[] } {
  const used: string[] = []
  const expanded = text.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (placeholder, id: string) => {
    const paste = pastes[Number(id)]
    if (paste === undefined) return placeholder
    used.push(paste)
    return paste
  })
  return { text: expanded, pastes: used }
}

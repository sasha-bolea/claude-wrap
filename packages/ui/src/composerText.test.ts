import { describe, expect, it } from 'vitest'
import { applySuggestion, expandPastes, isLongPaste, matchCommands, mention, pastePlaceholder, triggerAt } from './composerText.ts'

describe('composer text', () => {
  it('finds a command trigger only as the first word, a file trigger after a space or at the start', () => {
    expect(triggerAt('/comp', 5)).toEqual({ kind: 'command', query: 'comp', start: 0, end: 5 })
    expect(triggerAt('/compact now', 12)).toBeUndefined()
    expect(triggerAt('see @src/ma', 11)).toEqual({ kind: 'file', query: 'src/ma', start: 4, end: 11 })
    expect(triggerAt('@', 1)).toEqual({ kind: 'file', query: '', start: 0, end: 1 })
    expect(triggerAt('mail@host', 9)).toBeUndefined()
    expect(triggerAt('see @src now', 8)).toEqual({ kind: 'file', query: 'src', start: 4, end: 8 })
  })

  it('applies a suggestion with a trailing space and puts the caret after it', () => {
    expect(applySuggestion('see @ma and', { kind: 'file', query: 'ma', start: 4, end: 7 }, '@src/main.ts')).toEqual({ text: 'see @src/main.ts  and', caret: 17 })
    expect(applySuggestion('/co', { kind: 'command', query: 'co', start: 0, end: 3 }, '/compact')).toEqual({ text: '/compact ', caret: 9 })
    expect(applySuggestion('@sr', { kind: 'file', query: 'sr', start: 0, end: 3 }, '@src/')).toEqual({ text: '@src/', caret: 5 })
  })

  it('quotes mentions of paths with spaces', () => {
    expect(mention('src/a.ts')).toBe('@src/a.ts')
    expect(mention('my docs/a b.md')).toBe('@"my docs/a b.md"')
  })

  it('ranks commands by name prefix, then by name or description match', () => {
    const commands = [
      { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
      { name: 'context', description: 'Show context usage', argumentHint: '' },
      { name: 'clear', description: 'Clear history', argumentHint: '' },
      { name: 'recap', description: 'Summarize', argumentHint: '' }
    ]
    expect(matchCommands(commands, 'co').map((command) => command.name)).toEqual(['compact', 'context'])
    expect(matchCommands(commands, 'cap').map((command) => command.name)).toEqual(['recap'])
    expect(matchCommands(commands, 'usage').map((command) => command.name)).toEqual(['context'])
    expect(matchCommands(commands, '')).toHaveLength(4)
  })

  it('collapses long pastes into the CLI placeholder and expands them on send', () => {
    expect(isLongPaste('short')).toBe(false)
    expect(isLongPaste(Array.from({ length: 12 }, (_, n) => `line ${n}`).join('\n'))).toBe(true)
    expect(isLongPaste('x'.repeat(1001))).toBe(true)
    const log = 'a\nb\nc'
    const placeholder = pastePlaceholder(1, log)
    expect(placeholder).toBe('[Pasted text #1 +2 lines]')
    expect(expandPastes(`fix ${placeholder} please`, { 1: log, 2: 'deleted' })).toEqual({ text: 'fix a\nb\nc please', pastes: [log] })
  })
})

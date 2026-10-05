// The key bar's Ctrl: the next key typed becomes its control character (Ctrl+C stops a command, Ctrl+D ends the
// shell); anything else passes unchanged.
import { describe, expect, it } from 'vitest'
import { withCtrl } from './TerminalScreen.tsx'

describe('terminal key bar', () => {
  it('Ctrl turns a letter (either case) or @[\\]^_ into its control character, and leaves the rest alone', () => {
    expect(['c', 'C', 'd', 'z', '[', '@'].map(withCtrl)).toEqual(['\x03', '\x03', '\x04', '\x1a', '\x1b', '\x00'])
    expect(['1', '|', 'ab', '\x1b[A'].map(withCtrl)).toEqual(['1', '|', 'ab', '\x1b[A'])
  })
})

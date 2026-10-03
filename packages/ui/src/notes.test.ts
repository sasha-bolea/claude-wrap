// Sasha's rule for "use in a message": at send, the note is used up (deleted) when the message still holds at least
// 20% of its words, even if edited; otherwise it stays.
import { describe, expect, it } from 'vitest'
import { noteUsed } from './notes.ts'

describe('noteUsed', () => {
  it('counts the note words still in the message, case and punctuation aside', () => {
    expect(noteUsed('refactor the login form and add tests', 'refactor the login form and add tests please')).toBe(true)
    expect(noteUsed('one two three four five six seven eight nine ten', 'one two and more')).toBe(true)
    expect(noteUsed('one two three four five six seven eight nine ten', 'only one here')).toBe(false)
    expect(noteUsed('Ciao, mondo!', 'ciao a tutti')).toBe(true)
  })

  it('a repeated word counts as many times as the message has it; an empty note is never used', () => {
    expect(noteUsed('go go go go go', 'go')).toBe(true)
    expect(noteUsed('go go go go go go', 'go')).toBe(false)
    expect(noteUsed('', 'anything')).toBe(false)
  })
})

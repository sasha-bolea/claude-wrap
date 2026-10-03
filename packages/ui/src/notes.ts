// Share of a note's words that must still be in the message for the note to count as used (Sasha: 20%).
export const NOTE_USED_SHARE = 0.2

// Lower-case words (letters and digits of any language) of a text.
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// True when the message still holds at least NOTE_USED_SHARE of the note's words (each word counted as many times as
// the message has it): the note was used and is deleted at send. note: the note's text; message: what is sent.
export function noteUsed(note: string, message: string): boolean {
  const wanted = words(note)
  if (!wanted.length) return false
  const available = new Map<string, number>()
  for (const word of words(message)) available.set(word, (available.get(word) ?? 0) + 1)
  let found = 0
  for (const word of wanted) {
    const left = available.get(word) ?? 0
    if (!left) continue
    available.set(word, left - 1)
    found++
  }
  return found / wanted.length >= NOTE_USED_SHARE
}

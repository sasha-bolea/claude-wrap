import type { Memory } from '@athome/protocol'

// Helpers of the Memory panel (as /memory): which saved memory is the index, in what order they are listed.

// The saved memory kinds the panel has a translated word for; any other kind is shown as it comes.
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

// The kind as one of the known words, or undefined for an unknown one.
export const knownType = (type: string): MemoryType | undefined => MEMORY_TYPES.find((known) => known === type)

// Whether a saved memory is MEMORY.md, the index of the others (never deleted from the app).
export const isIndexPath = (path: string): boolean => /(^|[\\/])MEMORY\.md$/.test(path)

// The saved memories in the order the panel lists them: the index first, then the others newest first (those without
// a date last, in the order they came).
// Parameters: the memories as the core sent them. Returns a new array.
export function sortMemories(memories: Memory['memories']): Memory['memories'] {
  const rank = (memory: Memory['memories'][number]) => (isIndexPath(memory.path) ? Infinity : (memory.modifiedAt ?? -Infinity))
  return [...memories].sort((a, b) => (rank(b) === rank(a) ? 0 : rank(b) > rank(a) ? 1 : -1))
}

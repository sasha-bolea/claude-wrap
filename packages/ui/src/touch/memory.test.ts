import { describe, expect, it } from 'vitest'
import { isIndexPath, knownType, sortMemories } from './memory.ts'

const memory = (name: string, modifiedAt?: number, dir = '/m') => ({ name, path: `${dir}/${name}`, description: '', ...(modifiedAt === undefined ? {} : { modifiedAt }) })

describe('Memory panel helpers', () => {
  it('recognises the index by its file name only', () => {
    expect(isIndexPath('/home/x/memory/MEMORY.md')).toBe(true)
    expect(isIndexPath('C:\\m\\MEMORY.md')).toBe(true)
    expect(isIndexPath('/m/NOT_MEMORY.md')).toBe(false)
    expect(isIndexPath('/m/MEMORY.md.bak')).toBe(false)
  })

  it('lists the index first, then the memories newest first, undated ones last', () => {
    const sorted = sortMemories([memory('old.md', 1), memory('none.md'), memory('MEMORY.md', 0), memory('new.md', 9), memory('other-none.md')])
    expect(sorted.map((one) => one.name)).toEqual(['MEMORY.md', 'new.md', 'old.md', 'none.md', 'other-none.md'])
  })

  it('does not change the array it is given', () => {
    const given = [memory('a.md', 1), memory('b.md', 2)]
    sortMemories(given)
    expect(given.map((one) => one.name)).toEqual(['a.md', 'b.md'])
  })

  it('knows the four kinds and nothing else', () => {
    expect(knownType('feedback')).toBe('feedback')
    expect(knownType('journal')).toBeUndefined()
  })
})

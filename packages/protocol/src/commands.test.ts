import { describe, it, expect } from 'vitest'
import { COMMANDS, revokeCascade } from './commands.ts'

// Test that rewind commands exist and have correct schemas
describe('rewind commands', () => {
  it('tab.rewindPoints schema is valid', () => {
    const schema = COMMANDS['tab.rewindPoints']
    expect(schema).toBeDefined()
    expect(schema.args).toBeDefined()
    expect(schema.result).toBeDefined()

    // Validate args schema
    const validArgs = { tabId: 'test-tab' }
    const argsResult = schema.args.safeParse(validArgs)
    expect(argsResult.success).toBe(true)

    // Validate result schema
    const validResult = { points: [{ itemId: 'item1', text: 'hello' }] }
    const resultResult = schema.result.safeParse(validResult)
    expect(resultResult.success).toBe(true)

    // Validate result with images count
    const resultWithImages = { points: [{ itemId: 'item1', text: 'hello', images: 2 }] }
    const resultWithImagesResult = schema.result.safeParse(resultWithImages)
    expect(resultWithImagesResult.success).toBe(true)
  })

  it('tab.rewindPreview schema is valid', () => {
    const schema = COMMANDS['tab.rewindPreview']
    expect(schema).toBeDefined()

    // Validate args
    const validArgs = { tabId: 'test-tab', itemId: 'item1' }
    const argsResult = schema.args.safeParse(validArgs)
    expect(argsResult.success).toBe(true)

    // Validate result
    const validResult = { canRewind: true, filesChanged: ['file.ts'], insertions: 10, deletions: 5 }
    const resultResult = schema.result.safeParse(validResult)
    expect(resultResult.success).toBe(true)

    // Validate result with error
    const resultWithError = { canRewind: false, error: 'Cannot rewind' }
    const resultWithErrorResult = schema.result.safeParse(resultWithError)
    expect(resultWithErrorResult.success).toBe(true)
  })

  it('tab.rewind schema is valid', () => {
    const schema = COMMANDS['tab.rewind']
    expect(schema).toBeDefined()

    // Validate args with all modes
    ;(['both', 'conversation', 'code'] as const).forEach((mode) => {
      const validArgs = { tabId: 'test-tab', itemId: 'item1', mode }
      const argsResult = schema.args.safeParse(validArgs)
      expect(argsResult.success).toBe(true)
    })

    // Validate result
    const validResult = { text: 'hello', filesChanged: ['file.ts'], skippedLinks: 2 }
    const resultResult = schema.result.safeParse(validResult)
    expect(resultResult.success).toBe(true)

    // Validate result with newTabId
    const resultWithNewTab = { newTabId: 'new-tab-id' }
    const resultWithNewTabResult = schema.result.safeParse(resultWithNewTab)
    expect(resultWithNewTabResult.success).toBe(true)
  })
})

// The devices a revoke removes: the root and what it created, never the asker nor what the asker created.
describe('revokeCascade', () => {
  const devices = [{ deviceId: 'a' }, { deviceId: 'b', createdBy: 'a' }, { deviceId: 'c', createdBy: 'b' }, { deviceId: 'd', createdBy: 'c' }, { deviceId: 'e', createdBy: 'd' }]
  it('walks through every descendant', () => expect([...revokeCascade(devices, 'a')]).toEqual(['a', 'b', 'c', 'd', 'e']))
  it('skips the asker and the branch under it', () => expect([...revokeCascade(devices, 'a', 'c')]).toEqual(['a', 'b']))
  it('a leaf alone', () => expect([...revokeCascade(devices, 'e', 'a')]).toEqual(['e']))
})

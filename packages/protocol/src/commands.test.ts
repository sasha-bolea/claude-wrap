import { describe, it, expect } from 'vitest'
import { COMMANDS } from './commands.ts'
import { browserEventSchema } from './model.ts'

// Test browser command schemas and event parsing
describe('browser commands', () => {
  it('browser.navigate rejects invalid URLs', () => {
    const schema = COMMANDS['browser.navigate']
    const validUrl = { url: 'https://example.com' }
    const validResult = schema.args.safeParse(validUrl)
    expect(validResult.success).toBe(true)

    // Reject file:// URLs
    const fileUrl = { url: 'file:///etc/passwd' }
    const fileResult = schema.args.safeParse(fileUrl)
    expect(fileResult.success).toBe(false)

    // Reject javascript: URLs
    const jsUrl = { url: 'javascript:alert(1)' }
    const jsResult = schema.args.safeParse(jsUrl)
    expect(jsResult.success).toBe(false)

    // Reject chrome: URLs
    const chromeUrl = { url: 'chrome://settings' }
    const chromeResult = schema.args.safeParse(chromeUrl)
    expect(chromeResult.success).toBe(false)
  })

  it('browser.pointer enforces coordinate bounds', () => {
    const schema = COMMANDS['browser.pointer']
    const validPointer = { type: 'move' as const, x: 0.5, y: 0.5 }
    const validResult = schema.args.safeParse(validPointer)
    expect(validResult.success).toBe(true)

    // Reject x > 1
    const outOfBoundsX = { type: 'move' as const, x: 1.5, y: 0.5 }
    const outOfBoundsXResult = schema.args.safeParse(outOfBoundsX)
    expect(outOfBoundsXResult.success).toBe(false)

    // Reject y < 0
    const outOfBoundsY = { type: 'move' as const, x: 0.5, y: -0.1 }
    const outOfBoundsYResult = schema.args.safeParse(outOfBoundsY)
    expect(outOfBoundsYResult.success).toBe(false)
  })

  it('browser.text enforces max length', () => {
    const schema = COMMANDS['browser.text']
    const validText = { text: 'hello' }
    const validResult = schema.args.safeParse(validText)
    expect(validResult.success).toBe(true)

    // Reject text over 20000 chars
    const longText = { text: 'a'.repeat(20001) }
    const longResult = schema.args.safeParse(longText)
    expect(longResult.success).toBe(false)
  })

  it('browser.viewport enforces size bounds', () => {
    const schema = COMMANDS['browser.viewport']
    const validViewport = { width: 1024, height: 768, mobile: false }
    const validResult = schema.args.safeParse(validViewport)
    expect(validResult.success).toBe(true)

    // Reject width < 200
    const tooSmall = { width: 100, height: 768, mobile: false }
    const tooSmallResult = schema.args.safeParse(tooSmall)
    expect(tooSmallResult.success).toBe(false)
  })


  it('browser.frame event parses correctly', () => {
    const frameEvent = {
      type: 'browser.frame' as const,
      tabId: 'tab123',
      data: 'base64data',
      width: 1024,
      height: 768,
      viewportWidth: 800,
      viewportHeight: 600,
      seq: 42
    }
    const result = browserEventSchema.safeParse(frameEvent)
    expect(result.success).toBe(true)
  })
})

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

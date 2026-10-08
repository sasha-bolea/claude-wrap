import { describe, expect, it } from 'vitest'
import { destinationOf, sourceLabelKey, visibleText } from './permissions.ts'

describe('Permissions panel helpers', () => {
  it('visibleText spells out invisible and control characters and keeps plain text', () => {
    expect(visibleText('Bash(npm run test:*)')).toBe('Bash(npm run test:*)')
    expect(visibleText('Read​(x)')).toBe('Read\\u{200B}(x)')
    expect(visibleText('a\nb\tc')).toBe('a\\u{A}b\\u{9}c')
    expect(visibleText('a b‮c')).toBe('a\\u{A0}b\\u{202E}c')
    expect(visibleText('è日本')).toBe('è日本')
  })

  it('knows the sources it labels and the ones that are settings files', () => {
    expect(sourceLabelKey('session')).toBe('permSource_session')
    expect(sourceLabelKey('toolsNarrowing')).toBeUndefined()
    expect(sourceLabelKey('constructor')).toBeUndefined()
    expect(destinationOf('localSettings')).toBe('localSettings')
    expect(destinationOf('policySettings')).toBeUndefined()
  })
})

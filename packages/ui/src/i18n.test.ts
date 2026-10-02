import { describe, expect, it } from 'vitest'
import { createTranslator, pickLanguage } from './i18n.ts'

describe('i18n', () => {
  it('interpolates params into the chosen dictionary', () => {
    expect(createTranslator('it')('versions', { core: '1', sdk: '2', cli: '3' })).toBe('core 1 · SDK 2 · CLI 3')
    expect(createTranslator('en')('connecting')).not.toBe(createTranslator('it')('connecting'))
  })

  it('picks Italian for it-* locales and English otherwise', () => {
    expect(pickLanguage('it-IT')).toBe('it')
    expect(pickLanguage('de-DE')).toBe('en')
  })
})

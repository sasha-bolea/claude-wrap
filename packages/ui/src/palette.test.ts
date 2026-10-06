import { describe, expect, it } from 'vitest'
import { mix, paletteTokens } from './palette.ts'

const LIGHT = { background: '#faf9f7', surface: '#ffffff', text: '#1f1e1c', accent: '#c96442', danger: '#c62828', success: '#2e7d32' }
const DARK = { background: '#1e1d1b', surface: '#262523', text: '#ecebe8', accent: '#d97757', danger: '#ff6b5e', success: '#81c784' }

describe('palette', () => {
  it('mixes two colours', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  // As a user I pick 6 colours and the whole app follows: the 6 as they are, the rest made from them.
  it('makes every token of the app from the 6 colours', () => {
    const { tokens, scheme } = paletteTokens(LIGHT)
    expect(scheme).toBe('light')
    expect(tokens).toMatchObject({ '--background': '#faf9f7', '--surface': '#ffffff', '--text': '#1f1e1c', '--accent': '#c96442', '--danger': '#c62828', '--success': '#2e7d32' })
    expect(Object.keys(tokens).sort()).toEqual(['--accent', '--accent-text', '--background', '--border', '--danger', '--frame', '--scrim', '--success', '--surface', '--surface-2', '--text', '--text-muted'])
    for (const name of ['--border', '--surface-2', '--text-muted', '--frame']) expect(tokens[name]).toMatch(/^#[0-9a-f]{6}$/)
    expect(tokens['--scrim']).toMatch(/^rgba\(/)
  })

  // Light or dark is not chosen: it follows the background (native controls, scroll bars).
  it('is dark when the background is dark', () => {
    expect(paletteTokens(DARK).scheme).toBe('dark')
  })

  // The text on the accent (buttons) stays readable whatever the accent.
  it('writes on the accent in white or in black, whichever reads better', () => {
    expect(paletteTokens({ ...LIGHT, accent: '#c96442' }).tokens['--accent-text']).toBe('#ffffff')
    expect(paletteTokens({ ...LIGHT, accent: '#ffe066' }).tokens['--accent-text']).toBe('#000000')
  })
})

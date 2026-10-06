import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_PALETTE_ID, PRESET_PALETTES, paletteColorsSchema, type Palette } from '@athome/protocol'
import { mix, nextActive, paletteTokens } from './palette.ts'

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

  // There is no light/dark theme: the presets offer both, all valid, and one of them is the default.
  it('has at least 15 presets, light and dark, valid and distinct, the default among them', () => {
    expect(PRESET_PALETTES.length).toBeGreaterThanOrEqual(15)
    for (const preset of PRESET_PALETTES) expect(paletteColorsSchema.safeParse(preset.colors).success, preset.name).toBe(true)
    expect(new Set(PRESET_PALETTES.map((preset) => preset.paletteId)).size).toBe(PRESET_PALETTES.length)
    expect(new Set(PRESET_PALETTES.map((preset) => preset.name)).size).toBe(PRESET_PALETTES.length)
    const schemes = PRESET_PALETTES.map((preset) => paletteTokens(preset.colors).scheme)
    expect(schemes.filter((scheme) => scheme === 'light').length).toBeGreaterThanOrEqual(5)
    expect(schemes.filter((scheme) => scheme === 'dark').length).toBeGreaterThanOrEqual(5)
    expect(PRESET_PALETTES.some((preset) => preset.paletteId === DEFAULT_PALETTE_ID)).toBe(true)
  })

  // Before it connects, the app shows the default palette's colours (touch.css's base tokens).
  it('touch.css starts with the default palette', () => {
    const css = readFileSync(new URL('./touch.css', import.meta.url), 'utf8')
    const root = /:root \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const { tokens } = paletteTokens(PRESET_PALETTES.find((preset) => preset.paletteId === DEFAULT_PALETTE_ID)!.colors)
    for (const name of ['--background', '--surface', '--text', '--accent', '--accent-text', '--danger', '--success']) expect(root, name).toContain(`${name}: ${tokens[name]};`)
    expect(css).not.toContain('prefers-color-scheme')
    expect(css).not.toContain('data-theme')
  })

  // First opening: the default palette; then the one picked follows its edits made elsewhere.
  it('picks the default palette on a device without one, and follows the one picked', () => {
    const palette = (paletteId: string, accent = '#123456'): Palette => ({ paletteId, name: paletteId, colors: { ...LIGHT, accent }, updatedAt: 1 })
    expect(nextActive(undefined, [palette('mine'), palette(DEFAULT_PALETTE_ID)])).toEqual({ paletteId: DEFAULT_PALETTE_ID, colors: { ...LIGHT, accent: '#123456' } })
    expect(nextActive(undefined, [palette('mine'), palette('other')])?.paletteId).toBe('mine')
    expect(nextActive(undefined, [])).toBeUndefined()
    const active = { paletteId: 'mine', colors: { ...LIGHT, accent: '#123456' } }
    expect(nextActive(active, [palette('mine')])).toBeUndefined()
    expect(nextActive(active, [palette('mine', '#abcdef')])).toEqual({ paletteId: 'mine', colors: { ...LIGHT, accent: '#abcdef' } })
    expect(nextActive(active, [palette(DEFAULT_PALETTE_ID)])).toBeUndefined()
  })
})

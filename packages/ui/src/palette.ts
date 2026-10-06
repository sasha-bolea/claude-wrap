import type { Palette, PaletteColors } from '@athome/protocol'

// The palette on this device: its id and its colours, kept so the app starts with them before it connects.
export type ActivePalette = { paletteId: string; colors: PaletteColors }

const ACTIVE_KEY = 'claude-wrap:palette'
// Screens showing which palette is on (useSyncExternalStore).
const listeners = new Set<() => void>()
const HEX = /^#[0-9a-f]{6}$/i
// The tokens a palette sets on the page (touch.css :root), removed again to go back to the theme.
const TOKENS = ['--background', '--surface', '--surface-2', '--border', '--text', '--text-muted', '--accent', '--accent-text', '--danger', '--success', '--frame', '--scrim'] as const

// Red, green, blue (0-255) of a #rrggbb colour.
function rgbOf(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

// A colour between from (amount 0) and to (amount 1), as #rrggbb.
export function mix(from: string, to: string, amount: number): string {
  const [a, b] = [rgbOf(from), rgbOf(to)]
  return '#' + a.map((channel, i) => Math.round(channel + ((b[i] ?? channel) - channel) * amount).toString(16).padStart(2, '0')).join('')
}

// A colour channel (0-255) in linear light (0-1).
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// WCAG relative luminance of a #rrggbb colour (0 black … 1 white).
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

// Every colour token of the app from a palette's 6: the 6 as they are, the others mixed from them; scheme: light or
// dark, from the background (native controls, scroll bars).
export function paletteTokens(colors: PaletteColors): { tokens: Record<string, string>; scheme: 'light' | 'dark' } {
  const { background, surface, text, accent, danger, success } = colors
  const dark = luminance(background) < 0.4
  const [r, g, b] = rgbOf(text)
  // White on the accent unless it reads poorly there (contrast under 3:1).
  const accentText = 1.05 / (luminance(accent) + 0.05) >= 3 ? '#ffffff' : '#000000'
  const tokens = {
    '--background': background,
    '--surface': surface,
    '--surface-2': mix(surface, text, 0.06),
    '--border': mix(background, text, 0.14),
    '--text': text,
    '--text-muted': mix(text, background, 0.4),
    '--accent': accent,
    '--accent-text': accentText,
    '--danger': danger,
    '--success': success,
    '--frame': dark ? mix(background, '#000000', 0.4) : mix(background, text, 0.08),
    '--scrim': dark ? 'rgba(0, 0, 0, .55)' : `rgba(${r}, ${g}, ${b}, .38)`
  }
  return { tokens, scheme: dark ? 'dark' : 'light' }
}

// The links of the Home screen icon, the tab icon and the manifest: the server draws them in an accent asked with
// ?accent=rrggbb (packages/server/src/tinted.ts).
const ICON_LINKS = ['apple-touch-icon', 'icon', 'manifest'] as const

// The accent this page's address asks for (the link "Icon in this colour" copies, opened in the browser that adds
// the app to the Home screen), as #rrggbb; undefined when it names none.
function addressAccent(): string | undefined {
  const accent = `#${new URLSearchParams(location.search).get('accent') ?? ''}`
  return HEX.test(accent) ? accent.toLowerCase() : undefined
}

// Points the icon and manifest links at their version in the accent (#rrggbb) — the address's own accent first —
// or back to the fixed files when there is none. Pages without these links (the desktop) are left as they are.
export function pointIcons(accent?: string): void {
  const chosen = addressAccent() ?? accent
  for (const rel of ICON_LINKS) {
    const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
    if (!link) continue
    link.dataset.original ??= link.getAttribute('href') ?? ''
    link.setAttribute('href', chosen ? `${link.dataset.original}?accent=${chosen.slice(1)}` : link.dataset.original)
  }
}

// Puts a palette's colours on the page; none: back to the theme's (touch.css).
export function applyPalette(colors?: PaletteColors): void {
  const style = document.documentElement.style
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.dataset.original ??= meta.content
  pointIcons(colors?.accent)
  if (!colors) {
    for (const token of TOKENS) style.removeProperty(token)
    style.removeProperty('color-scheme')
    if (meta?.dataset.original) meta.content = meta.dataset.original
    return
  }
  const { tokens, scheme } = paletteTokens(colors)
  for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
  style.setProperty('color-scheme', scheme)
  if (meta) meta.content = colors.accent
}

// The palette on this device; undefined: the theme's colours (or storage unavailable).
export function readActivePalette(): ActivePalette | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null') as ActivePalette | null
    return saved && Object.values(saved.colors ?? {}).every((color) => HEX.test(color)) ? saved : undefined
  } catch {
    return undefined
  }
}

// Turns a palette on for this device (none: the theme's colours), remembered and applied.
export function setActivePalette(active?: ActivePalette): void {
  try {
    if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active))
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // storage unavailable: the palette holds until the app reloads
  }
  applyPalette(active?.colors)
  for (const listener of listeners) listener()
}

// Registers a listener of the palette on here changing. Returns the unsubscribe function.
export function subscribeActivePalette(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The id of the palette on here (undefined: the theme's colours), as a snapshot for useSyncExternalStore.
export const activePaletteId = (): string | undefined => readActivePalette()?.paletteId

// Follows the backend's palettes: the one on here changed elsewhere → its new colours. One that is gone keeps its
// last colours (another backend may not have it) until another is picked.
export function followPalettes(palettes: Palette[]): void {
  const active = readActivePalette()
  const saved = active && palettes.find((palette) => palette.paletteId === active.paletteId)
  if (saved && JSON.stringify(saved.colors) !== JSON.stringify(active.colors)) setActivePalette({ paletteId: saved.paletteId, colors: saved.colors })
}

// The 6 main colours shown on the page right now (a new palette starts from them).
export function currentColors(): PaletteColors {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim()
    return HEX.test(value) ? value.toLowerCase() : fallback
  }
  return {
    background: token('--background', '#faf9f7'),
    surface: token('--surface', '#ffffff'),
    text: token('--text', '#1f1e1c'),
    accent: token('--accent', '#c96442'),
    danger: token('--danger', '#c62828'),
    success: token('--success', '#2e7d32')
  }
}

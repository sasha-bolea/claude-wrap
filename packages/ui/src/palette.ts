import { DEFAULT_PALETTE_ID, PALETTE_COLORS, type Palette, type PaletteColors } from '@athome/protocol'

// The palette on this device: its id and its colours, kept so the app starts with them before it connects.
export type ActivePalette = { paletteId: string; colors: PaletteColors }

const ACTIVE_KEY = 'claude-wrap:palette'
// Screens showing which palette is on (useSyncExternalStore).
const listeners = new Set<() => void>()
const HEX = /^#[0-9a-f]{6}$/i
// The tokens a palette sets on the page (touch.css :root), removed again to go back to the base colours.
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
// ?accent=rrggbb, and writes into the manifest's start address what the page's address carries for the installed
// app (packages/server/src/tinted.ts).
const ICON_LINKS = ['apple-touch-icon', 'icon', 'manifest'] as const
// What the address may carry into the installed app: pairing code, palette id, its 6 colours (rrggbb, comma-separated).
const CARRIED = ['pair', 'palette', 'colors'] as const

// The palette the page's address carries (the app's setup page, then the installed app's start address); undefined
// when it carries none or a malformed one.
export function paletteFromAddress(): ActivePalette | undefined {
  const query = new URLSearchParams(location.search)
  const paletteId = query.get('palette')
  const values = (query.get('colors') ?? '').split(',').map((value) => `#${value.toLowerCase()}`)
  if (!paletteId || values.length !== PALETTE_COLORS.length || !values.every((value) => HEX.test(value))) return undefined
  return { paletteId, colors: Object.fromEntries(PALETTE_COLORS.map((key, i) => [key, values[i]!])) as PaletteColors }
}

// The address carrying a palette for the installed app, with its pairing code: '/?pair=…&palette=…&colors=…'.
export function addressWithPalette(code: string, palette: Palette): string {
  const colors = PALETTE_COLORS.map((key) => palette.colors[key].slice(1)).join(',')
  return `/?${new URLSearchParams({ pair: code, palette: palette.paletteId, colors })}`
}

// The accent this page's address asks for (the link "Icon in this colour", or the palette carried by the setup page),
// as #rrggbb; undefined when it names none.
function addressAccent(): string | undefined {
  const query = new URLSearchParams(location.search)
  const accent = `#${query.get('accent') ?? ''}`
  return HEX.test(accent) ? accent.toLowerCase() : paletteFromAddress()?.colors.accent
}

// Points the icon and manifest links at their version in the accent (#rrggbb) — the address's own accent first —
// or back to the fixed files when there is none; the manifest link also passes on what the address carries. Pages
// without these links (the desktop) are left as they are.
export function pointIcons(accent?: string): void {
  const chosen = addressAccent() ?? accent
  const address = new URLSearchParams(location.search)
  for (const rel of ICON_LINKS) {
    const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
    if (!link) continue
    link.dataset.original ??= link.getAttribute('href') ?? ''
    const query = new URLSearchParams()
    if (rel === 'manifest') for (const key of CARRIED) if (address.get(key)) query.set(key, address.get(key)!)
    if (chosen) query.set('accent', chosen.slice(1))
    link.setAttribute('href', query.size ? `${link.dataset.original}?${query}` : link.dataset.original)
  }
}

// Puts a palette's colours on the page; none: back to touch.css's base colours (the default palette's). A dark one also
// marks the page "dark-palette" (iOS's status bar text is white: touch.css puts a dark strip under it otherwise).
export function applyPalette(colors?: PaletteColors): void {
  const style = document.documentElement.style
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.dataset.original ??= meta.content
  pointIcons(colors?.accent)
  if (!colors) {
    for (const token of TOKENS) style.removeProperty(token)
    style.removeProperty('color-scheme')
    document.documentElement.classList.remove('dark-palette')
    if (meta?.dataset.original) meta.content = meta.dataset.original
    return
  }
  const { tokens, scheme } = paletteTokens(colors)
  for (const [token, value] of Object.entries(tokens)) style.setProperty(token, value)
  style.setProperty('color-scheme', scheme)
  document.documentElement.classList.toggle('dark-palette', scheme === 'dark')
  if (meta) meta.content = colors.accent
}

// The palette on this device; undefined: none picked yet (or storage unavailable).
export function readActivePalette(): ActivePalette | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null') as ActivePalette | null
    return saved && Object.values(saved.colors ?? {}).every((color) => HEX.test(color)) ? saved : undefined
  } catch {
    return undefined
  }
}

// Turns a palette on for this device (none: the base colours until the default is picked), remembered and applied.
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

// The id of the palette on here (undefined: none yet), as a snapshot for useSyncExternalStore.
export const activePaletteId = (): string | undefined => readActivePalette()?.paletteId

// The palette this device should turn on, given the one on now and the backend's palettes; undefined: no change.
// None on yet (first opening): the default one, else the first. The one on changed elsewhere: its new colours. One
// that is gone keeps its last colours (another backend may not have it) until another is picked.
export function nextActive(active: ActivePalette | undefined, palettes: Palette[]): ActivePalette | undefined {
  if (!active) {
    const first = palettes.find((palette) => palette.paletteId === DEFAULT_PALETTE_ID) ?? palettes[0]
    return first && { paletteId: first.paletteId, colors: first.colors }
  }
  const saved = palettes.find((palette) => palette.paletteId === active.paletteId)
  return saved && JSON.stringify(saved.colors) !== JSON.stringify(active.colors) ? { paletteId: saved.paletteId, colors: saved.colors } : undefined
}

// Follows the backend's palettes (see nextActive).
export function followPalettes(palettes: Palette[]): void {
  const next = nextActive(readActivePalette(), palettes)
  if (next) setActivePalette(next)
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

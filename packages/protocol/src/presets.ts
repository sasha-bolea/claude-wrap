import type { PaletteColors } from './model.ts'

// The palettes a backend starts with (core adds them once; then they are ordinary palettes, edited and deleted like
// the others), light and dark: the app has no light/dark theme, only palettes.
export type PresetPalette = { paletteId: string; name: string; colors: PaletteColors }

// Shorthand: the 6 colours in PALETTE_COLORS order (background, surface, text, accent, danger, success).
function preset(slug: string, name: string, [background, surface, text, accent, danger, success]: readonly [string, string, string, string, string, string]): PresetPalette {
  return { paletteId: `preset-${slug}`, name, colors: { background, surface, text, accent, danger, success } }
}

export const PRESET_PALETTES: readonly PresetPalette[] = [
  preset('athome-light', 'AtHome chiaro', ['#faf9f7', '#ffffff', '#1f1e1c', '#c96442', '#c62828', '#2e7d32']),
  preset('sage', 'Salvia', ['#f4f6f2', '#ffffff', '#1e2620', '#4f7a5a', '#b3261e', '#2e7d32']),
  preset('ocean', 'Oceano', ['#f3f7fa', '#ffffff', '#14202b', '#1f6fb2', '#c62828', '#2e7d32']),
  preset('lavender', 'Lavanda', ['#f7f5fb', '#ffffff', '#221d2e', '#6b4fbb', '#c62828', '#2e7d32']),
  preset('coral', 'Corallo', ['#fff7f5', '#ffffff', '#2a1a17', '#d0533f', '#b3261e', '#2e7d32']),
  preset('paper', 'Carta', ['#fdf6e3', '#fffbef', '#3b3428', '#b58900', '#dc322f', '#5f7a00']),
  preset('mint', 'Menta', ['#f2f8f6', '#ffffff', '#13241f', '#0f8a74', '#c62828', '#2e7d32']),
  preset('rose', 'Rosa', ['#fbf4f7', '#ffffff', '#2b1820', '#c2185b', '#b71c1c', '#2e7d32']),
  preset('slate', 'Ardesia', ['#f5f6f8', '#ffffff', '#1b1f24', '#3f51b5', '#c62828', '#2e7d32']),
  preset('athome-dark', 'AtHome scuro', ['#1e1d1b', '#262523', '#ecebe8', '#d97757', '#ff6b5e', '#81c784']),
  preset('night', 'Notte', ['#0f1419', '#171d24', '#e6edf3', '#4c9aff', '#f47067', '#57ab5a']),
  preset('forest', 'Foresta', ['#121a15', '#18231c', '#e3ece5', '#5fb37a', '#ef6f6c', '#8bd17c']),
  preset('graphite', 'Grafite', ['#18181b', '#222226', '#ececee', '#f0a33a', '#ff6b6b', '#6fcf7f']),
  preset('amethyst', 'Ametista', ['#17141f', '#211c2c', '#ebe6f5', '#a78bfa', '#ff7a85', '#7ed69a']),
  preset('abyss', 'Abisso', ['#0b1a1e', '#12262b', '#dcecef', '#2bb3c0', '#ff7b72', '#7ee787']),
  preset('wine', 'Vino', ['#1c1214', '#26191c', '#f0e4e6', '#e0577a', '#ff6b5e', '#81c784']),
  preset('contrast', 'Alto contrasto', ['#000000', '#111111', '#ffffff', '#ffd60a', '#ff453a', '#32d74b'])
]

// The palette of a device that has not picked one (first opening). Its colours are also touch.css's base tokens and
// the iPhone splash screens' (apps/mobile/scripts/icons.ts): change them together.
export const DEFAULT_PALETTE_ID = 'preset-athome-light'

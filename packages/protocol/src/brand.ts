// The "@~" mark ("at home") as a pixel grid, '#' = ink: a 7×7 "@", one blank column, a 5-wide "~". One source for the
// PNG drawing (packages/server/src/markIcon.ts: app icons and iPhone launch images) and the app's launch screen
// (packages/ui/src/touch/Splash.tsx), so the iOS launch image and the app show the same glyph.
export const MARK_ROWS: readonly string[] = [
  '.#####.......',
  '#.....#......',
  '#..##.#......',
  '#.#.#.#..##.#',
  '#..###..#.##.',
  '#............',
  '.#####.......'
]

// The launch glyph on a phone, in CSS points (= iOS points): one grid cell, and how far the glyph's top edge sits
// above the screen's vertical centre. The glyph is centred horizontally. Launch image and launch screen both use these.
export const LAUNCH_CELL_POINTS = 16 / 3
export const LAUNCH_GLYPH_ABOVE_CENTRE = 93.5 - 76 / 3

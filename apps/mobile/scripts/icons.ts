// Generates the PWA images and writes their <link> tags into index.html. Run after changing the design:
// `node apps/mobile/scripts/icons.ts`. The mark itself is drawn by @athome/server/markIcon (the server draws the
// icons in a palette's accent with it too).
// - Icons public/icon-180.png, -192, -512: the "@~" mark ("at home") in a blocky face on the accent colour (iOS
//   rounds the corners).
// - iPhone splash screens public/splash/<w>x<h>.png: one flat neutral grey (LAUNCH) with nothing on it. iOS caches
//   them at install, so they cannot follow a palette; the app's own launch screen (ui/touch/Splash.tsx) continues
//   the same grey and the page behind it is that grey too. iOS shows one only when its size matches the screen exactly.
// Icon colour: the default palette's accent.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DEFAULT_PALETTE_ID, PRESET_PALETTES } from '@athome/protocol'
import { canvas, markIcon, png, type Rgb } from '@athome/server/markIcon'

// A #rrggbb colour as red, green, blue.
function rgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const DEFAULT = PRESET_PALETTES.find((preset) => preset.paletteId === DEFAULT_PALETTE_ID)!.colors
// The iOS launch image's colour (also --launch-colour in touch.css and the manifest's background_color).
const LAUNCH = rgb('#8e8e93')
const ACCENT = rgb(DEFAULT.accent)
// iPhone screens in portrait: width and height in CSS points, pixel ratio (SE 2nd gen … 17 Pro Max, Air).
const IPHONES = [
  [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3],
  [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [420, 912, 3]
] as const
const PUBLIC = new URL('../public/', import.meta.url)
const INDEX = new URL('../index.html', import.meta.url)

for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, PUBLIC), markIcon(size, ACCENT))
}

rmSync(new URL('splash/', PUBLIC), { recursive: true, force: true })
mkdirSync(new URL('splash/', PUBLIC), { recursive: true })
const links: string[] = []
for (const [width, height, ratio] of IPHONES) {
  const splash = canvas(width * ratio, height * ratio, LAUNCH)
  const file = `${width * ratio}x${height * ratio}.png`
  writeFileSync(new URL(`splash/${file}`, PUBLIC), png(splash))
  const media = `screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`
  links.push(`    <link rel="apple-touch-startup-image" media="${media}" href="/splash/${file}" />`)
}

// The tags go between the two splash comments of index.html.
const START = '<!-- splash screens: written by scripts/icons.ts -->'
const END = '<!-- /splash screens -->'
const html = readFileSync(INDEX, 'utf8')
const from = html.indexOf(START)
const to = html.indexOf(END)
if (from < 0 || to < from) throw new Error(`index.html needs the comments ${START} and ${END}`)
writeFileSync(INDEX, `${html.slice(0, from + START.length)}\n${links.join('\n')}\n    ${html.slice(to)}`)
console.log(`3 icons, ${links.length} splash screens`)

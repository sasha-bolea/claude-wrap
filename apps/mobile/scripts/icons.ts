// Generates the PWA images and writes their <link> tags into index.html. Run after changing the design:
// `node apps/mobile/scripts/icons.ts`. The mark itself is drawn by @athome/server/markIcon (the server draws the
// icons in a palette's accent with it too).
// - Icons public/icon-180.png, -192, -512: the "@~" mark ("at home") in a blocky face on the accent colour (iOS
//   rounds the corners).
// - iPhone splash screens public/splash/<w>x<h>-<theme>.png, light and dark: the mark (88 points, radius 24, as on
//   the app's start screen) on the background colour. iOS shows one only when its size matches the screen exactly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { canvas, drawMark, markIcon, png, type Rgb } from '@athome/server/markIcon'

// The tokens of packages/ui/src/touch.css (--background, --accent) in both themes.
const THEMES = {
  light: { background: [0xfa, 0xf9, 0xf7], accent: [0xc9, 0x64, 0x42] },
  dark: { background: [0x1e, 0x1d, 0x1b], accent: [0xd9, 0x77, 0x57] }
} as const satisfies Record<string, { background: Rgb; accent: Rgb }>
// iPhone screens in portrait: width and height in CSS points, pixel ratio (SE 2nd gen … 17 Pro Max, Air).
const IPHONES = [
  [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3],
  [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [420, 912, 3]
] as const
// Splash mark: size and corner radius in points; its top sits where the start screen's centred group puts it.
const MARK = 88
const MARK_RADIUS = 24
const MARK_ABOVE_CENTRE = 93.5
const PUBLIC = new URL('../public/', import.meta.url)
const INDEX = new URL('../index.html', import.meta.url)

for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, PUBLIC), markIcon(size, THEMES.light.accent))
}

mkdirSync(new URL('splash/', PUBLIC), { recursive: true })
const links: string[] = []
for (const [width, height, ratio] of IPHONES) {
  for (const [theme, colours] of Object.entries(THEMES)) {
    const splash = canvas(width * ratio, height * ratio, colours.background)
    const size = MARK * ratio
    drawMark(splash, Math.floor((width * ratio - size) / 2), Math.round((height / 2 - MARK_ABOVE_CENTRE) * ratio), size, MARK_RADIUS * ratio, colours.accent)
    const file = `${width * ratio}x${height * ratio}-${theme}.png`
    writeFileSync(new URL(`splash/${file}`, PUBLIC), png(splash))
    const media = `screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${theme})`
    links.push(`    <link rel="apple-touch-startup-image" media="${media}" href="/splash/${file}" />`)
  }
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

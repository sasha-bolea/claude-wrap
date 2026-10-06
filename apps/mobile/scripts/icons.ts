// Generates the PWA images and writes their <link> tags into index.html. Run after changing the design:
// `node apps/mobile/scripts/icons.ts`.
// - Icons public/icon-180.png, -192, -512: the "@~" mark ("at home") in a blocky face on the accent colour (iOS
//   rounds the corners).
// - iPhone splash screens public/splash/<w>x<h>-<theme>.png, light and dark: the mark (88 points, radius 24, as on
//   the app's start screen) on the background colour. iOS shows one only when its size matches the screen exactly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

type Rgb = readonly [number, number, number]
type Image = { width: number; height: number; data: Buffer }

// The tokens of packages/ui/src/touch.css (--background, --accent) in both themes.
const THEMES = {
  light: { background: [0xfa, 0xf9, 0xf7], accent: [0xc9, 0x64, 0x42] },
  dark: { background: [0x1e, 0x1d, 0x1b], accent: [0xd9, 0x77, 0x57] }
} as const satisfies Record<string, { background: Rgb; accent: Rgb }>
const WHITE: Rgb = [0xff, 0xff, 0xff]
// iPhone screens in portrait: width and height in CSS points, pixel ratio (SE 2nd gen … 17 Pro Max, Air).
const IPHONES = [
  [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3],
  [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [420, 912, 3]
] as const
// Splash mark: size and corner radius in points; its top sits where the start screen's centred group puts it.
const MARK = 88
const MARK_RADIUS = 24
const MARK_ABOVE_CENTRE = 93.5
// The mark's bitmap, '#' = ink: a 7×7 "@", one blank column, a 5-wide "~".
const MARK_ROWS = [
  '.#####.......',
  '#.....#......',
  '#..##.#......',
  '#.#.#.#..##.#',
  '#..###..#.##.',
  '#............',
  '.#####.......'
]
const PUBLIC = new URL('../public/', import.meta.url)
const INDEX = new URL('../index.html', import.meta.url)

// An RGB image filled with one colour, rows already prefixed with PNG filter byte 0.
function canvas(width: number, height: number, colour: Rgb): Image {
  const stride = 1 + width * 3
  const row = Buffer.alloc(stride)
  for (let x = 0; x < width; x++) row.set(colour, 1 + x * 3)
  const data = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) row.copy(data, y * stride)
  return { width, height, data }
}

// True where the mark pixel (x, y), counted from the bitmap's top-left corner, is inked.
function inked(x: number, y: number, cell: number): boolean {
  if (x < 0 || y < 0) return false
  return MARK_ROWS[Math.floor(y / cell)]?.[Math.floor(x / cell)] === '#'
}

// True when pixel (x, y) of a size×size square lies inside its rounded corners.
function insideCorners(x: number, y: number, size: number, radius: number): boolean {
  const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0)
  const dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}

// Paints the "@~" mark: a size×size accent square at (left, top) with the glyphs in white, centred.
function drawMark(image: Image, left: number, top: number, size: number, radius: number, accent: Rgb): void {
  const cell = Math.floor(size / 16)
  const glyphLeft = Math.floor((size - MARK_ROWS[0]!.length * cell) / 2)
  const glyphTop = Math.floor((size - MARK_ROWS.length * cell) / 2)
  const stride = 1 + image.width * 3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideCorners(x, y, size, radius)) continue
      image.data.set(inked(x - glyphLeft, y - glyphTop, cell) ? WHITE : accent, (top + y) * stride + 1 + (left + x) * 3)
    }
  }
}

// PNG chunk with its length and CRC.
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// The image as an 8-bit RGB PNG file.
function png(image: Image): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(image.data)), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [180, 192, 512]) {
  const icon = canvas(size, size, THEMES.light.accent)
  drawMark(icon, 0, 0, size, 0, THEMES.light.accent)
  writeFileSync(new URL(`icon-${size}.png`, PUBLIC), png(icon))
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

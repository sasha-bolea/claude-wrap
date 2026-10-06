import { crc32, deflateSync } from 'node:zlib'

// The "@~" mark ("at home") as PNG images, without image libraries: a blocky face in white on the accent colour.
// Used by apps/mobile/scripts/icons.ts (the PWA's fixed icons and splash screens) and by the server (icons in the
// accent of a device's palette).

export type Rgb = readonly [number, number, number]
export type Image = { width: number; height: number; data: Buffer }

const WHITE: Rgb = [0xff, 0xff, 0xff]
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

// An RGB image filled with one colour, rows already prefixed with PNG filter byte 0.
export function canvas(width: number, height: number, colour: Rgb): Image {
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
export function drawMark(image: Image, left: number, top: number, size: number, radius: number, accent: Rgb): void {
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
export function png(image: Image): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(image.data)), chunk('IEND', Buffer.alloc(0))])
}

// The app icon: a size×size PNG, the mark filling it on the accent colour (square: the systems round the corners).
export function markIcon(size: number, accent: Rgb): Buffer {
  const icon = canvas(size, size, accent)
  drawMark(icon, 0, 0, size, 0, accent)
  return png(icon)
}

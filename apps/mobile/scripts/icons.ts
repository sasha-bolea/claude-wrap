// Generates the PWA icons (public/icon-180.png, -192, -512): "cw" in a blocky face on the accent colour.
// Run once after changing the design: `node apps/mobile/scripts/icons.ts`. iOS rounds the corners itself.
import { writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const ACCENT = [0xc9, 0x64, 0x42]
const WHITE = [0xff, 0xff, 0xff]
// 5×7 glyphs, '#' = ink.
const GLYPHS: Record<string, string[]> = {
  c: ['.....', '.....', '.####', '#....', '#....', '#....', '.####'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.']
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

// One square RGB icon of the given size.
function icon(size: number): Buffer {
  const cell = Math.floor(size / 16)
  const textWidth = 11 * cell
  const left = Math.floor((size - textWidth) / 2)
  const top = Math.floor((size - 7 * cell) / 2) - cell
  const inked = (x: number, y: number) => {
    const column = Math.floor((x - left) / cell)
    const row = Math.floor((y - top) / cell)
    if (row < 0 || row > 6 || column < 0 || column > 10 || column === 5) return false
    const glyph = column < 5 ? GLYPHS.c! : GLYPHS.w!
    return glyph[row]![column < 5 ? column : column - 6] === '#'
  }
  const rows = Array.from({ length: size }, (_, y) => Buffer.from([0, ...Array.from({ length: size }, (_, x) => (inked(x, y) ? WHITE : ACCENT)).flat()]))
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), icon(size))

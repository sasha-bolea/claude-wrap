// User story: the app icon on my phone's Home screen has the main colour (accent) of the palette I picked, while a
// request without a colour, or with a bad one, still gets the PWA's fixed files.
import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { createTinter, MAX_TINTED } from './tinted.ts'
import type { StaticFiles } from './staticFiles.ts'

const MANIFEST = {
  name: 'AtHome',
  theme_color: '#c96442',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
}

// Static files with the manifest only (the icons are drawn, not read).
function files(): StaticFiles {
  return new Map([['/manifest.webmanifest', { body: Buffer.from(JSON.stringify(MANIFEST)), type: 'application/manifest+json' }]])
}

// Width, height and the top-left pixel of an 8-bit RGB PNG made by markIcon.
function readPng(body: Buffer): { width: number; height: number; corner: number[] } {
  expect(body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const idat = body.indexOf('IDAT')
  const data = inflateSync(body.subarray(idat + 4, idat + 4 + body.readUInt32BE(idat - 4)))
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20), corner: [...data.subarray(1, 4)] }
}

describe('icons in the palette accent', () => {
  it('draws each app icon size on the accent colour', () => {
    const tinted = createTinter(files())
    for (const size of [180, 192, 512]) {
      const file = tinted(`/icon-${size}.png`, '?accent=1A2b3C')
      expect(file?.type).toBe('image/png')
      expect(readPng(file!.body)).toEqual({ width: size, height: size, corner: [0x1a, 0x2b, 0x3c] })
    }
  })

  it('the manifest names the tinted icons and takes the accent as theme colour', () => {
    const file = createTinter(files())('/manifest.webmanifest', '?accent=1a2b3c')
    expect(file?.type).toBe('application/manifest+json')
    const manifest = JSON.parse(file!.body.toString())
    expect(manifest.name).toBe('AtHome')
    expect(manifest.theme_color).toBe('#1a2b3c')
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(['/icon-192.png?accent=1a2b3c', '/icon-512.png?accent=1a2b3c'])
    expect(manifest.icons[1].purpose).toBe('any maskable')
  })

  it('no colour, a bad colour or another file: nothing tinted (the fixed file is served)', () => {
    const tinted = createTinter(files())
    expect(tinted('/icon-192.png', '')).toBeUndefined()
    for (const bad of ['?accent=12345', '?accent=zzzzzz', '?accent=%23123456', '?accent=1234567']) expect(tinted('/icon-192.png', bad)).toBeUndefined()
    expect(tinted('/icon-64.png', '?accent=123456')).toBeUndefined()
    expect(tinted('/index.html', '?accent=123456')).toBeUndefined()
    expect(createTinter(new Map())('/manifest.webmanifest', '?accent=123456')).toBeUndefined()
  })

  it('keeps a bounded number of drawn files, the same colour drawn once', () => {
    const tinted = createTinter(files())
    const first = tinted('/icon-180.png', '?accent=000000')
    expect(tinted('/icon-180.png', '?accent=000000')).toBe(first)
    for (let i = 1; i <= MAX_TINTED; i++) tinted('/icon-180.png', `?accent=${i.toString(16).padStart(6, '0')}`)
    const again = tinted('/icon-180.png', '?accent=000000')
    expect(again).not.toBe(first)
    expect(again?.body).toEqual(first?.body)
  })
})

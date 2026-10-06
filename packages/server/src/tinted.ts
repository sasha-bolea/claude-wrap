import { markIcon } from './markIcon.ts'
import type { StaticFile, StaticFiles } from './staticFiles.ts'

// The PWA's icons and manifest in the accent of a device's palette: `/icon-<size>.png?accent=rrggbb` and
// `/manifest.webmanifest?accent=rrggbb` (the page points its links there while a palette is on). The answer depends
// only on the colour, so it reveals nothing; drawn files are kept in a small cache so a stream of colours cannot
// grow the memory.

export const MAX_TINTED = 32
const ICON = /^\/icon-(180|192|512)\.png$/
const ACCENT = /^[0-9a-f]{6}$/i

// Returns the lookup: the tinted file for a request path and its query string ('?accent=…'); undefined when the
// request names no valid colour or no tintable file (the fixed file is served then). files: the PWA build, for the
// manifest to start from.
export function createTinter(files: StaticFiles): (pathname: string, search: string) => StaticFile | undefined {
  const cache = new Map<string, StaticFile>()
  return (pathname, search) => {
    const accent = new URLSearchParams(search).get('accent')
    if (!accent || !ACCENT.test(accent)) return undefined
    const key = `${pathname}?${accent.toLowerCase()}`
    const cached = cache.get(key)
    if (cached) return cached
    const file = draw(files, pathname, accent.toLowerCase())
    if (!file) return undefined
    if (cache.size >= MAX_TINTED) cache.delete(cache.keys().next().value!)
    cache.set(key, file)
    return file
  }
}

// The icon or manifest of pathname in the accent (rrggbb, lower case); undefined for any other path.
function draw(files: StaticFiles, pathname: string, accent: string): StaticFile | undefined {
  const size = ICON.exec(pathname)?.[1]
  if (size) {
    const value = parseInt(accent, 16)
    return { body: markIcon(Number(size), [(value >> 16) & 255, (value >> 8) & 255, value & 255]), type: 'image/png' }
  }
  const manifest = pathname === '/manifest.webmanifest' ? files.get(pathname) : undefined
  if (!manifest) return undefined
  const data = JSON.parse(manifest.body.toString()) as { theme_color?: string; icons?: { src: string }[] }
  data.theme_color = `#${accent}`
  data.icons = data.icons?.map((icon) => ({ ...icon, src: `${icon.src}?accent=${accent}` }))
  return { body: Buffer.from(JSON.stringify(data)), type: manifest.type }
}

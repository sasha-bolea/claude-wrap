import { markIcon } from './markIcon.ts'
import type { StaticFile, StaticFiles } from './staticFiles.ts'

// The PWA's icons and manifest made for one device: `/icon-<size>.png?accent=rrggbb` in the accent of its palette,
// and `/manifest.webmanifest?…` whose icons take that accent and whose start address carries what the browser set up
// for the installed app (`pair` code, `palette` id, its `colors`: iOS keeps Safari's storage apart from the app's).
// The page points its links there (packages/ui/src/palette.ts). The answer depends only on the query, so it reveals
// nothing; drawn files are kept in a small cache so a stream of queries cannot grow the memory.

export const MAX_TINTED = 32
const ICON = /^\/icon-(180|192|512)\.png$/
const ACCENT = /^[0-9a-f]{6}$/i
// What the start address may carry: a pairing code, a palette id, the palette's 6 colours (rrggbb, comma-separated).
const CARRIED = { pair: /^[\w-]{10,64}$/, palette: /^[\w-]{1,64}$/, colors: /^[0-9a-f]{6}(,[0-9a-f]{6}){5}$/i } as const

type Asked = { accent?: string; start?: URLSearchParams }

// The valid parts of a query: the accent (asked, else the palette's 4th colour), the values for the start address.
function asked(search: string): Asked {
  const query = new URLSearchParams(search)
  const start = new URLSearchParams()
  for (const [key, pattern] of Object.entries(CARRIED)) {
    const value = query.get(key)
    if (value && pattern.test(value)) start.set(key, key === 'colors' ? value.toLowerCase() : value)
  }
  const accent = [query.get('accent'), start.get('colors')?.split(',')[3]].find((value) => value && ACCENT.test(value))
  return { accent: accent?.toLowerCase(), start: start.size ? start : undefined }
}

// Returns the lookup: the file made for a request path and its query string; undefined when the request asks for
// nothing valid or names no such file (the fixed file is served then). files: the PWA build, for the manifest to
// start from.
export function createTinter(files: StaticFiles): (pathname: string, search: string) => StaticFile | undefined {
  const cache = new Map<string, StaticFile>()
  return (pathname, search) => {
    const wanted = asked(search)
    if (!wanted.accent && !wanted.start) return undefined
    const key = `${pathname}?${wanted.accent ?? ''}&${wanted.start?.toString() ?? ''}`
    const cached = cache.get(key)
    if (cached) return cached
    const file = draw(files, pathname, wanted)
    if (!file) return undefined
    if (cache.size >= MAX_TINTED) cache.delete(cache.keys().next().value!)
    cache.set(key, file)
    return file
  }
}

// The icon (in the accent) or the manifest of pathname; undefined for any other path or nothing to change.
function draw(files: StaticFiles, pathname: string, { accent, start }: Asked): StaticFile | undefined {
  const size = ICON.exec(pathname)?.[1]
  if (size) {
    if (!accent) return undefined
    const value = parseInt(accent, 16)
    return { body: markIcon(Number(size), [(value >> 16) & 255, (value >> 8) & 255, value & 255]), type: 'image/png' }
  }
  const manifest = pathname === '/manifest.webmanifest' ? files.get(pathname) : undefined
  if (!manifest) return undefined
  const data = JSON.parse(manifest.body.toString()) as { start_url?: string; theme_color?: string; icons?: { src: string }[] }
  if (accent) {
    data.theme_color = `#${accent}`
    data.icons = data.icons?.map((icon) => ({ ...icon, src: `${icon.src}?accent=${accent}` }))
  }
  if (start) data.start_url = `/?${start.toString()}`
  return { body: Buffer.from(JSON.stringify(data)), type: manifest.type }
}

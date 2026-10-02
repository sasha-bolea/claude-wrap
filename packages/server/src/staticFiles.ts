import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

// The PWA build served from memory: loaded once at startup, looked up by exact path. No path derived from a
// request ever reaches the filesystem, so traversal tricks (`/../`, `..%2f`, `%2e%2e/`) can only miss.

export type StaticFile = { body: Buffer; type: string }
export type StaticFiles = Map<string, StaticFile>

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

// Every file under dir, keyed by its URL path ('/index.html', '/assets/x.js'). A missing dir gives no files.
export async function loadStaticFiles(dir: string): Promise<StaticFiles> {
  const files: StaticFiles = new Map()
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const url = `/${relative(dir, path).split(sep).join('/')}`
    files.set(url, { body: await readFile(path), type: TYPES[extname(entry.name)] ?? 'application/octet-stream' })
  }
  return files
}

// The file for a request path: exact match, '/' and extension-less paths (client routes) → index.html.
export function findStatic(files: StaticFiles, pathname: string): StaticFile | undefined {
  const exact = files.get(pathname)
  if (exact) return exact
  const last = pathname.split('/').pop() ?? ''
  return last.includes('.') ? undefined : files.get('/index.html')
}

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { WIDGET_FRAME_CSP, WIDGET_FRAME_PATH } from '../protocol/src/widgetFrame.ts'

// Vite plugin of the apps that show the chat (PWA, desktop renderer): emits widget-frame.html at the root of the build
// and serves it, with its own CSP, from the dev server. Production servers set that CSP themselves. The page is found
// through the package (build tools bundle this file into the app's folder, so a path relative to it would not hold).
export function widgetFrame(): Plugin {
  const file = createRequire(import.meta.url).resolve('@athome/ui/widget-frame.html')
  const read = () => readFileSync(file, 'utf8')
  return {
    name: 'athome-widget-frame',
    configureServer(server) {
      server.middlewares.use(WIDGET_FRAME_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Content-Security-Policy', WIDGET_FRAME_CSP)
        res.end(read())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WIDGET_FRAME_PATH.slice(1), source: read() })
    }
  }
}

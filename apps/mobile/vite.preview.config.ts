import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

// The live preview of the PWA (deploy/preview): the real UI from Vite's dev server, with hot reload, in front of a real
// AtHome server on the scripted fake SDK. Reached through Tailscale Serve at https://server.taildb4b9b.ts.net:8448
// (→ 127.0.0.1:3007), so the hot-reload socket goes back to that port over wss. The server's own paths (the app's
// WebSocket, pairing, palette setup) are passed to the backend container with the browser's Host kept (changeOrigin
// false: the string shorthand would rewrite it), which the server checks against its public URL.
const BACKEND = process.env.PREVIEW_BACKEND ?? 'http://backend:3013'

export default mergeConfig(
  base,
  defineConfig({
    server: {
      host: '0.0.0.0',
      port: 3007,
      strictPort: true,
      allowedHosts: ['server.taildb4b9b.ts.net'],
      hmr: { clientPort: 8448, protocol: 'wss' },
      proxy: {
        '/ws': { target: BACKEND, ws: true, changeOrigin: false },
        '/pair': { target: BACKEND, changeOrigin: false },
        '/setup': { target: BACKEND, changeOrigin: false }
      }
    }
  })
)

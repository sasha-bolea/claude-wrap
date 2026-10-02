import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The PWA: the shared UI in its touch layout, built to dist/ and served by packages/server from memory.
// No dev server (and so no port): `npm run start:server` builds it and starts the server on 3012.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true }
})

import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Only `dependencies` stay external (the SDK, which locates its native CLI binary relative to its package, and
// node-pty, whose native addon is loaded from its prebuilds folder);
// the workspace packages are devDependencies and get bundled.
// main builds two entries: the Electron main process and the core host that runs in a utilityProcess.
// Renderer dev server port registered in ~/.claude/porte.md (5199).
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts', coreHost: 'src/main/coreHost.ts' } }
    }
  },
  // Preload in CommonJS: with sandbox: true Electron does not load an ESM preload.
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react()],
    server: { port: 5199, strictPort: true }
  }
})

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { widgetFrame } from '../../packages/ui/widgetFramePlugin.ts'

// The PWA: the shared UI in its touch layout, built to dist/ and served by packages/server from memory.
// No dev server (and so no port): `npm run start:server` builds it and starts the server on 3012.
// Every build has a unique id, compiled in (__APP_BUILD__) and published in dist/version.json: the installed app
// compares the two to offer a newer build. The version shown in Settings is package version · commit
// (CLAUDE_WRAP_BUILD from deploy/install.sh, whose release folder has no .git; else git; else "dev").

// Commit of the working copy, or undefined outside a git checkout.
function gitCommit(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}

const commit = (process.env.CLAUDE_WRAP_BUILD || gitCommit() || 'dev').slice(0, 7)
const { version: packageVersion } = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }
const version = `${packageVersion} · ${commit}`
const build = `${commit}-${Date.now().toString(36)}`

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    react(),
    widgetFrame(),
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build, version }) })
      }
    }
  ],
  define: { __APP_BUILD__: JSON.stringify(build), __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist', emptyOutDir: true }
})

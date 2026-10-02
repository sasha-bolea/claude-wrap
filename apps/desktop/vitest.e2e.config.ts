import { defineConfig } from 'vitest/config'

// Desktop end-to-end suite (`npm run e2e`): drives the built app with playwright's Electron support.
// One app at a time: each test launches its own instance.
export default defineConfig({
  test: {
    include: ['apps/desktop/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxConcurrency: 1
  }
})

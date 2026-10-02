import { defineConfig } from 'vitest/config'

// PWA end-to-end suite (`npm run e2e:mobile`): the built PWA on the in-process server, in the system Chrome.
export default defineConfig({
  test: {
    include: ['apps/mobile/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['src/**/*.test.ts'], testTimeout: 20_000, fileParallelism: false }
})

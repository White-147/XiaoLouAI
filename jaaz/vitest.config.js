import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    include: ['**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**'],
    threads: false,
    isolate: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./electron', import.meta.url).pathname,
    },
  },
})

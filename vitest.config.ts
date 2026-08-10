import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
      '@config': resolve('config')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})

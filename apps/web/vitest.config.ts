import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  css: {
    // Skip PostCSS/Tailwind entirely in unit tests — components assert on
    // rendered classes/markup, not computed styles, so there's nothing to
    // process and this keeps the suite fast.
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Point shared-types to its source directly (no build step needed)
      '@echonotes/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    reporters: ['verbose'],
  },
})

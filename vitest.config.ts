import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify('https://api.f3nation.com/v1'),
  },
})

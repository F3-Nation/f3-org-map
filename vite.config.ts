import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/v1/org-chart': 'http://localhost:3000'
    }
  }
})

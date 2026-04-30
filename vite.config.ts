import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');
  const appVersion = process.env.npm_package_version ?? '0.0.0';
  return {
    base: './',
    server: {
      proxy: {
        '/v1/org-chart': env.VITE_API_BASE?.includes('localhost')
          ? 'http://localhost:3000'
          : 'https://api.f3nation.com'
      }
    },
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE),
      __APP_VERSION__: JSON.stringify(appVersion)
    }
  }
})

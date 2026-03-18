import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  server: {
    proxy: {
      // Proxy Azure Retail Prices API to work around missing CORS headers.
      // Used only in dev; in production the app falls back to static pricing.
      '/azure-pricing': {
        target: 'https://prices.azure.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/azure-pricing/, '/api/retail/prices'),
      },
    },
  },
})

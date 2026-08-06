import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
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
      // FX rates. Dev hits the provider directly and receives its raw shape;
      // production goes through /api/fx-rates, which normalises and validates.
      // fxRates.ts accepts either shape so the two stay interchangeable.
      '/fx-rates': {
        target: 'https://api.frankfurter.dev',
        changeOrigin: true,
        rewrite: () => '/v1/latest?base=USD&symbols=GBP,EUR',
      },
    },
  },
})

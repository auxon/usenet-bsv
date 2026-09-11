import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/usenetbsv/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5180,
    proxy: {
      '/usenetbsv/api': 'http://localhost:8787',
      '/usenetbsv/facilitator': 'http://localhost:8787',
      '/usenetbsv/health': 'http://localhost:8787',
      '/usenetbsv/pricing': 'http://localhost:8787',
      '/usenetbsv/supported': 'http://localhost:8787',
    },
  },
})

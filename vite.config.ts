import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.COMFYART_URL ?? 'http://127.0.0.1:8190'

export default defineConfig({
  base: '/comfyart/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/ws': { target: backend, ws: true },
      '/comfyart/thumb': backend,
      '/comfyart/pdf': backend,
      '/comfyart/model-paths': backend,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the API runs in Docker on 127.0.0.1:7860.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:7860',
      '/ws': { target: 'ws://127.0.0.1:7860', ws: true },
    },
  },
})

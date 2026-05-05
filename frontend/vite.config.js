import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envDir: '..', // .env is at project root, not inside frontend/
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/vworld-wfs': {
        target: 'https://api.vworld.kr',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/vworld-wfs/, '/req/wfs'),
      },
    },
  },
})

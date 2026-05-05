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
      // Backend-generated data (radar, satellite, sigwx images)
      // Frontend public/data/ serves aviation geojson — don't catch those here
      '/data/radar': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/data/satellite': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/data/sigwx_low': {
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

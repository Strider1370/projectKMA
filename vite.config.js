import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/vworld-wfs': {
        target: 'https://api.vworld.kr',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/vworld-wfs/, '/req/wfs'),
      },
    },
  },
})

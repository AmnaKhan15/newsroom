import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the Python API runs via `python dev_server.py`; on Vercel it is served from /api.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
})

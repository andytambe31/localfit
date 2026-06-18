import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Local dev/build stays at '/'; the Pages build passes VITE_BASE=/localfit/.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  // Dev frontend is pinned to 5173 and proxies /api to the DEV backend (8799),
  // never the prod backend (8788) — keeps dev fully isolated from prod.
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8799' },
  },
})

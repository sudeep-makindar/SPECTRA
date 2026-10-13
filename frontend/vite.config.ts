import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

// Phones need HTTPS for camera/mic access. If scripts/make_https.sh has
// generated certs, serve the dev server over HTTPS on the LAN.
const certDir = path.resolve(__dirname, '../config/certs')
const https = fs.existsSync(path.join(certDir, 'cert.pem'))
  ? { key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true,
    https,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/data': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})

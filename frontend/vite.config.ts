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

// Backend port; override with SPECTRA_BACKEND_PORT if 8000 is taken.
const backend = `localhost:${process.env.SPECTRA_BACKEND_PORT ?? 8000}`

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
        target: `http://${backend}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://${backend}`,
        ws: true,
      },
      '/data': {
        target: `http://${backend}`,
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [preact(), basicSsl()],
  // Use BASE_PATH environment variable, defaulting to '/' (for local development)
  // GitHub Actions sets BASE_PATH to /repo-name/
  base: process.env.BASE_PATH || '/',
  server: {
    https: true,
    host: true
  }
})

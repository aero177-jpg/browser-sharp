import { defineConfig } from 'vite'

export default defineConfig({
  // Use BASE_PATH environment variable, defaulting to '/' (for local development)
  // GitHub Actions sets BASE_PATH to /repo-name/
  base: process.env.BASE_PATH || '/',
})

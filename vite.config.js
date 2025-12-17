import { defineConfig } from 'vite'

export default defineConfig({
  // 使用环境变量 BASE_PATH，默认为 '/'（本地开发时）
  // GitHub Actions 会设置 BASE_PATH 为 /repo-name/
  base: process.env.BASE_PATH || '/',
})

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // 允许引用 client/ 之外的 shared/ 目录
  resolve: {},
  publicDir: false,
});

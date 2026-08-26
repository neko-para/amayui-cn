import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',               // 相对路径：任意 GitHub Pages 子路径可跑
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { port: 1420 },
});

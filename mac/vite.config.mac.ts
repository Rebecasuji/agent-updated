import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist/app',
    assetsDir: 'assets',
    minify: 'terser',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Tauri reads devUrl from tauri.conf.json, so the port is fixed on both
  // sides. strictPort makes a clash fail loudly instead of silently moving to
  // 1421 and leaving the window pointed at nothing.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})

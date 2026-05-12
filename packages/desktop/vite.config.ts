import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'src-tauri/frontend/dist',
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: true,
    // Vitest covers component/unit tests under src/. Playwright covers
    // browser-level specs under e2e/ and must not be discovered by Vitest.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'e2e-lan/**', 'node_modules/**', 'dist/**', 'src-tauri/**'],
  },
})

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
});

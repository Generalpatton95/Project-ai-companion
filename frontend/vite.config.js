// ============================================================================
// FILE: frontend/vite.config.js
// ============================================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the backend (backend/config defaults to port 8000)
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://localhost:8000'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js'
  }
});

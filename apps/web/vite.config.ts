import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API is the same origin in production; in development it is proxied so cookies,
    // CSRF and relative paths all behave the same way here as they will there.
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
  },
});

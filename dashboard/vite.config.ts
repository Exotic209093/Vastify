import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3099',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3099',
        changeOrigin: true,
        secure: false,
      },
      '/odata': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3099',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: '../api/public',
    emptyOutDir: true,
    sourcemap: true,
  },
});

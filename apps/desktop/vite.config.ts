/**
 * The desktop console's build.
 *
 * Deliberately plain. This app has no service worker, no offline archive and no
 * install story - it is a tool you open on a machine that has a network, and
 * every complication the PWA carries for the offline case would be dead weight
 * here. Sharing that config would have coupled two products with opposite
 * constraints.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4300,
    /*
     * The public API in development.
     *
     * Proxied rather than called cross-origin so the app's own fetches are
     * same-origin in dev exactly as they are in production, and a CORS mistake
     * cannot hide behind a permissive dev server.
     */
    proxy: {
      '/api': { target: 'https://darkroute.ai', changeOrigin: true },
      '/cameras': { target: 'https://darkroute.ai', changeOrigin: true },
      '/records': { target: 'https://darkroute.ai', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});

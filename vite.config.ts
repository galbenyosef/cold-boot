import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the static build works from any sub-path (e.g. GitHub Pages project sites).
  base: './',
  // Parallel dev servers (one per agent) need separate optimizer caches: set VITE_CACHE_DIR.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // a new build / dev server start invalidates the phones' stored sound renders (src/audio/synth/cache.ts)
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});

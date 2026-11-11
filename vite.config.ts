import { defineConfig } from 'vite';

export default defineConfig({
  // Parallel dev servers (one per agent) need separate optimizer caches: set VITE_CACHE_DIR.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});

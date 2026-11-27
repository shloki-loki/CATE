/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative base so the production build in dist/ also works from any sub-path
// (GitHub Pages, a file server, `npm run preview`).
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Rapier's -compat build inlines its WASM as base64: the physics chunk is
    // ~4.3 MB minified (~1.7 MB gzipped) by design. Keep it in its own cached chunk.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      // Two pages: the game, and the vehicle test arena (T0025).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        arena: fileURLToPath(new URL('./arena.html', import.meta.url)),
      },
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge')) return 'rapier';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

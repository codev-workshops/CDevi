import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Gallery app plus the static reference screens as a multi-page build, so Vite resolves the
// self-hosted font imports in css/cdevi.css for both. URLs: /gallery/ and /reference-screens/<name>.html
const refs = Object.fromEntries(
  readdirSync(resolve(import.meta.dirname, 'reference-screens'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [
      `reference-screens/${f.replace(/\.html$/, '')}`,
      resolve(import.meta.dirname, 'reference-screens', f),
    ]),
);

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  appType: 'mpa',
  build: {
    outDir: 'gallery-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { gallery: resolve(import.meta.dirname, 'gallery/index.html'), ...refs },
    },
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1', open: '/gallery/' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
});

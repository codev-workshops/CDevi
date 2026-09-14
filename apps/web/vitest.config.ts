import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'next/navigation': fileURLToPath(
        new URL('./tests/mocks/next-navigation.ts', import.meta.url),
      ),
      'server-only': fileURLToPath(new URL('./tests/mocks/server-only.ts', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/components/**/*.test.{ts,tsx}'],
    css: true,
    testTimeout: 15_000,
  },
});

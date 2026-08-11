import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Only our unit/component tests — Playwright e2e specs live in e2e/*.spec.ts.
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});

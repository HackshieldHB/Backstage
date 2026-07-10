import { defineConfig } from '@playwright/test';

/**
 * E2E against the production build of web + the compiled api.
 * `pnpm -r build` must run first (verify does this).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'pnpm start',
      port: 3000,
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});

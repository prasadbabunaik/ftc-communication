// Playwright E2E config for the FTC Communication Portal.
//
// Prereqs (one-time): `npm run db:migrate && npm run db:seed`.
// Run:                `npm run test:e2e` (auto-starts `next dev` on :3000).
// Headed/debug:       `npx playwright test --headed` / `--debug`.
// Single file:        `npx playwright test tests/auth.spec.js`.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3000);
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,           // shared DB → run serially to keep assertions stable
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Auto-start `next dev`. Re-uses an existing server on :3000 if you're
  // already running one — handy during local iteration.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

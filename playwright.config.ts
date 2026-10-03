import { defineConfig } from '@playwright/test';

// Extension tests need a persistent context and a headed browser (run under xvfb in CI: `xvfb-run -a npm run e2e`).
// Set CHROMIUM_PATH to test against a specific Chrome/Chromium build (used by the minimum-version compat job, ADR-011).
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0, // no retries: a flaky extension test is a bug, not noise (blueprint §1.2)
  timeout: 60_000,
  reporter: [['list']],
});

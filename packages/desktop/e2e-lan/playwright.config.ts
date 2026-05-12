import { defineConfig } from '@playwright/test'

/**
 * LAN E2E suite — drives Chromium against a real `panna-cotta` Axum server
 * running in a temp config directory.
 *
 * Concurrency: single worker because the binary is a singleton (one port,
 * one config dir per spawn). All specs share the lifecycle managed by
 * global-setup / global-teardown.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
})

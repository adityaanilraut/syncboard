import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 20_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BOARD_A ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
});

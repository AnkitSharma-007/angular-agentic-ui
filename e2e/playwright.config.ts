import { defineConfig } from '@playwright/test';

// Throwaway harness for manual-QA automation (not part of the app build).
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './artifacts/output',
  use: {
    baseURL: 'http://localhost:4300',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});

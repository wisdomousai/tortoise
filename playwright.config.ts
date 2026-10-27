import { defineConfig } from '@playwright/test';
export default defineConfig({
  // The starter's own specs, and each example's and sample's under `<name>/e2e`.
  testDir: '.',
  testMatch: ['tests/e2e/**/*.pw.ts', 'examples/*/e2e/**/*.pw.ts', 'samples/*/e2e/**/*.pw.ts'],
  // Each spec runs the applications it names, so their web builds must exist.
  globalSetup: './scripts/build-web-examples.ts',
  timeout: 30_000,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});

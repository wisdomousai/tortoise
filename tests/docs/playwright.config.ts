/**
 * The screenshot specs of the documentation: `showcase/examples/<app>/e2e/*.shots.ts` and
 * `tests/docs/*.shots.ts`. The root config matches only `*.pw.ts`, so `bun run test:e2e` leaves
 * these out. 1024×768 at two device pixels, light scheme and UTC give the same picture on every
 * machine; `bun run docs:screenshots` runs them.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../..',
  testMatch: ['showcase/examples/*/e2e/*.shots.ts', 'tests/docs/*.shots.ts'],
  // Each spec runs the application it shoots, so its web build must exist.
  globalSetup: '../../scripts/build-docs-shots.ts',
  outputDir: '../../dist/docs-shots',
  timeout: 120_000,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    timezoneId: 'UTC',
    locale: 'en-US',
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});

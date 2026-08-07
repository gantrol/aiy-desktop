import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end lane.
 *
 * Playwright drives Electron over the DevTools protocol: input is dispatched
 * into the renderer, not injected at the OS level. It never moves the real
 * pointer, never steals keyboard focus, and never touches the active desktop
 * application, which is what the repository's automation rule requires.
 *
 * Requires a build first (`npm run build`); `global-setup.ts` fails fast with
 * that instruction rather than timing out on a missing entry point.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e'),
  testMatch: '**/*.e2e.ts',
  globalSetup: path.resolve(__dirname, 'e2e/support/global-setup.ts'),
  outputDir: path.resolve(__dirname, 'test-results'),
  fullyParallel: false,
  // Each worker owns a whole Electron app and a temp local space; more than two
  // in parallel starves disk I/O and turns timing assertions into noise.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Font rasterisation differs across platforms; baselines are per-platform
      // and a small threshold absorbs sub-pixel antialiasing only.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

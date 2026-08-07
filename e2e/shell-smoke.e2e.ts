import { action, activeView, view, views } from './support/selectors';
import { appMetrics, expect, test } from './support/app-fixture';
import { expectAppReady, navigateTo, waitForRendererIdle } from './support/app-driver';
import {
  attachResponsiveActionResults,
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  runResponsiveAction,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
  visible,
  type ResponsiveActionResult,
} from './support/responsiveness';

/**
 * Journey 1 — cold start.
 *
 * Covers the largest zero-coverage block in the project in a single pass:
 * `main/index.ts` lifecycle, `preload/index.ts`, the `app:bootstrap` IPC route,
 * and `App.tsx`. Nothing below the E2E lane can reach any of it, because none of
 * it exists outside a running two-process Electron app.
 */
test.describe('application shell', () => {
  test('boots into a usable window against an isolated local space', async ({ page }) => {
    await expectAppReady(page);
    await expect(page.locator(view(views.gallery))).toBeVisible();
  });

  test('navigates between the primary views', async ({ page, app }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    await expectAppReady(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    for (const targetView of [views.gallery, views.dictionary]) {
      timings.push(
        await runResponsiveAction({
          label: `navigate to ${targetView}`,
          action: () => page.locator(view(targetView)).click(),
          probes: [visible(`${targetView} active`, page.locator(activeView(targetView)))],
        }),
      );
    }
    await expect(page.locator(action('dictionary-new'))).toBeVisible();
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('reports no Electron errors during boot', async ({ page, app, diagnostics }) => {
    await navigateTo(page, views.gallery);
    await waitForRendererIdle(page);

    const errors = [
      ...diagnostics.mainErrors.map((error) => `main: ${error}`),
      ...diagnostics.rendererErrors.map((error) => `renderer: ${error}`),
      ...diagnostics.networkFailures.map((error) => `network: ${error}`),
    ];
    expect(errors, `Electron errors:\n${errors.join('\n')}`).toEqual([]);
    // Sanity check that the main process is genuinely up, not just the window.
    expect(await appMetrics(app)).not.toHaveLength(0);
  });

  test('never reaches a provider: the loopback stub sees no traffic on boot', async ({ page, stub }) => {
    await navigateTo(page, views.gallery);
    await waitForRendererIdle(page);

    expect(stub.requests).toEqual([]);
  });
});

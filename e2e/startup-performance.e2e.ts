import { performance as nodePerformance } from 'node:perf_hooks';
import { appMetrics, expect, test } from './support/app-fixture';
import {
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
} from './support/responsiveness';
import { view, views } from './support/selectors';

/**
 * Startup performance.
 *
 * Recorded, not gated. CI hardware varies by more than the regressions worth
 * catching, so absolute thresholds here would either never fire or fire
 * constantly. The budgets below are deliberately loose smoke limits; real
 * regression detection compares medians of the same journey across builds on
 * one machine.
 */
const budgets = {
  firstWindowMs: 15_000,
  firstPaintMs: 20_000,
};

test.describe('startup performance', () => {
  test('reaches an interactive window and records the timing profile', async ({ app, launchTiming }, testInfo) => {
    const page = await app.firstWindow();
    const firstWindowMs = nodePerformance.now() - launchTiming.startedAtMs;
    launchTiming.firstWindowMs ??= firstWindowMs;

    await page.waitForSelector(view(views.dictionary), { state: 'visible' });
    const firstPaintMs = nodePerformance.now() - launchTiming.startedAtMs;

    const navigation = await page.evaluate(() => {
      // The project's DOM lib types `EntryType` without "navigation", so the
      // lookup goes through a widened signature rather than a blanket `any`.
      const getEntries = window.performance.getEntriesByType.bind(window.performance) as (
        type: string,
      ) => PerformanceEntry[];
      const entry = getEntries('navigation')[0] as PerformanceNavigationTiming | undefined;
      return entry
        ? {
            domContentLoadedMs: entry.domContentLoadedEventEnd - entry.startTime,
            loadEventMs: entry.loadEventEnd - entry.startTime,
          }
        : null;
    });

    const profile = {
      electronLaunchMs: Math.round(launchTiming.electronLaunchMs ?? firstPaintMs),
      firstWindowMs: Math.round(launchTiming.firstWindowMs ?? firstWindowMs),
      firstPaintMs: Math.round(firstPaintMs),
      ...navigation,
      processes: await appMetrics(app),
    };

    // Attached rather than asserted: the artifact is the deliverable, so a trend
    // can be built without a brittle pass/fail line.
    await testInfo.attach('startup-profile.json', {
      body: JSON.stringify(profile, null, 2),
      contentType: 'application/json',
    });

    expect(profile.firstWindowMs).toBeLessThan(budgets.firstWindowMs);
    expect(profile.firstPaintMs).toBeLessThan(budgets.firstPaintMs);
  });
});

test.describe('background service startup resilience', () => {
  test.use({ workerReadyDelayMs: 3_000 });

  test('shows a responsive reconnecting UI while the worker handshake is delayed', async ({
    app,
    page,
    launchTiming,
  }, testInfo) => {
    const status = page.locator('[data-action="background-tasks"]');

    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-worker-state', 'RECONNECTING');
    const firstFeedbackMs = nodePerformance.now() - launchTiming.startedAtMs;
    expect(firstFeedbackMs, 'startup showed no foreground feedback within 2 seconds').toBeLessThan(2_000);

    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await expect(status).toHaveAttribute('data-worker-state', 'CONNECTED', { timeout: 8_000 });

    await testInfo.attach('delayed-worker-startup.json', {
      body: JSON.stringify({ configuredWorkerReadyDelayMs: 3_000, firstFeedbackMs }, null, 2),
      contentType: 'application/json',
    });
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });
});

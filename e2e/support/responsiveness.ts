import { performance as nodePerformance } from 'node:perf_hooks';
import { expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';

export interface ResponseProbe {
  label: string;
  active(): Promise<boolean>;
}

export interface ResponsiveActionResult {
  label: string;
  actionSettledMs: number;
  responseMs: number;
  observed: string;
}

export async function runResponsiveAction(options: {
  label: string;
  action(): Promise<unknown>;
  probes: ResponseProbe[];
  budgetMs?: number;
}): Promise<ResponsiveActionResult> {
  const budgetMs = options.budgetMs ?? 2_000;
  const startedAt = nodePerformance.now();
  await options.action();
  const actionSettledMs = nodePerformance.now() - startedAt;
  expect(actionSettledMs, `${options.label} was not actionable within ${budgetMs} ms`).toBeLessThan(budgetMs);

  let observed = '';
  await expect
    .poll(
      async () => {
        for (const probe of options.probes) {
          if (await probe.active()) {
            observed = probe.label;
            return true;
          }
        }
        return false;
      },
      {
        message: `${options.label} showed neither progress nor its result within ${budgetMs} ms`,
        timeout: Math.max(50, budgetMs - actionSettledMs),
        intervals: [16, 32, 64, 100],
      },
    )
    .toBe(true);

  return {
    label: options.label,
    actionSettledMs,
    responseMs: nodePerformance.now() - startedAt,
    observed,
  };
}

export function visible(label: string, locator: ReturnType<Page['locator']>): ResponseProbe {
  return {
    label,
    active: () =>
      locator
        .evaluateAll((elements) =>
          elements.some((element) => {
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity || 1) > 0 &&
              bounds.width > 0 &&
              bounds.height > 0
            );
          }),
        )
        .catch(() => false),
  };
}

export function hidden(label: string, locator: ReturnType<Page['locator']>): ResponseProbe {
  return {
    label,
    active: () =>
      locator
        .evaluateAll((elements) =>
          elements.every((element) => {
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number(style.opacity || 1) === 0 ||
              bounds.width === 0 ||
              bounds.height === 0
            );
          }),
        )
        .catch(() => false),
  };
}

export function attribute(
  label: string,
  locator: ReturnType<Page['locator']>,
  name: string,
  value: string,
): ResponseProbe {
  return {
    label,
    active: () =>
      locator
        .evaluateAll(
          (elements, expected) => elements.some((element) => element.getAttribute(expected.name) === expected.value),
          { name, value },
        )
        .catch(() => false),
  };
}

export function attributeNot(
  label: string,
  locator: ReturnType<Page['locator']>,
  name: string,
  value: string,
): ResponseProbe {
  return {
    label,
    active: () =>
      locator
        .evaluateAll(
          (elements, expected) =>
            elements.some((element) => {
              const actual = element.getAttribute(expected.name);
              return actual !== null && actual !== expected.value;
            }),
          { name, value },
        )
        .catch(() => false),
  };
}

export function textChanged(
  label: string,
  locator: ReturnType<Page['locator']>,
  previousText: string | null,
): ResponseProbe {
  return {
    label,
    active: () =>
      locator
        .evaluateAll(
          (elements, previous) =>
            elements.some((element) => {
              const current = element.textContent?.trim() ?? '';
              return current.length > 0 && current !== previous;
            }),
          previousText?.trim() ?? null,
        )
        .catch(() => false),
  };
}

export async function textContentNow(locator: ReturnType<Page['locator']>): Promise<string | null> {
  return locator
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim()).find(Boolean) ?? null)
    .catch(() => null);
}

interface RendererResponsivenessProfile {
  longTaskApiSupported: boolean;
  longTasks: Array<{ startTime: number; duration: number }>;
  eventLoopDelays: Array<{ at: number; delay: number }>;
}

interface MainProcessResponsivenessProfile {
  eventLoopDelays: Array<{ at: number; delay: number }>;
}

declare global {
  interface Window {
    __aiyE2eResponsiveness?: RendererResponsivenessProfile;
    __aiyE2eResponsivenessTimer?: number;
  }
}

export async function startRendererResponsivenessObserver(page: Page) {
  await page.evaluate(() => {
    if (window.__aiyE2eResponsivenessTimer) clearInterval(window.__aiyE2eResponsivenessTimer);
    const profile: RendererResponsivenessProfile = {
      longTaskApiSupported: PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false,
      longTasks: [],
      eventLoopDelays: [],
    };
    window.__aiyE2eResponsiveness = profile;

    if (profile.longTaskApiSupported) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          profile.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    }

    const intervalMs = 50;
    let previous = performance.now();
    window.__aiyE2eResponsivenessTimer = window.setInterval(() => {
      const current = performance.now();
      const delay = current - previous - intervalMs;
      if (delay >= 50) profile.eventLoopDelays.push({ at: current, delay });
      previous = current;
    }, intervalMs);
  });
}

export async function startMainProcessResponsivenessObserver(app: ElectronApplication) {
  await app.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __aiyE2eMainResponsiveness?: MainProcessResponsivenessProfile;
      __aiyE2eMainResponsivenessTimer?: ReturnType<typeof setInterval>;
    };
    if (runtime.__aiyE2eMainResponsivenessTimer) clearInterval(runtime.__aiyE2eMainResponsivenessTimer);
    const profile: MainProcessResponsivenessProfile = { eventLoopDelays: [] };
    runtime.__aiyE2eMainResponsiveness = profile;

    const intervalMs = 50;
    let previous = performance.now();
    runtime.__aiyE2eMainResponsivenessTimer = setInterval(() => {
      const current = performance.now();
      const delay = current - previous - intervalMs;
      if (delay >= 50) profile.eventLoopDelays.push({ at: current, delay });
      previous = current;
    }, intervalMs);
    runtime.__aiyE2eMainResponsivenessTimer.unref();
  });
}

export async function recordRendererResponsiveness(page: Page, testInfo: TestInfo, budgetMs = 2_000) {
  const profile = await page.evaluate(() => {
    if (window.__aiyE2eResponsivenessTimer) clearInterval(window.__aiyE2eResponsivenessTimer);
    return (
      window.__aiyE2eResponsiveness ?? {
        longTaskApiSupported: false,
        longTasks: [],
        eventLoopDelays: [],
      }
    );
  });
  const maxLongTaskMs = Math.max(0, ...profile.longTasks.map((entry) => entry.duration));
  const maxEventLoopDelayMs = Math.max(0, ...profile.eventLoopDelays.map((entry) => entry.delay));
  const artifact = { budgetMs, maxLongTaskMs, maxEventLoopDelayMs, ...profile };
  await testInfo.attach('renderer-responsiveness.json', {
    body: JSON.stringify(artifact, null, 2),
    contentType: 'application/json',
  });
  expect(maxLongTaskMs, `renderer long task exceeded the ${budgetMs} ms foreground budget`).toBeLessThan(budgetMs);
  expect(maxEventLoopDelayMs, `renderer event loop stalled beyond the ${budgetMs} ms foreground budget`).toBeLessThan(
    budgetMs,
  );
  return artifact;
}

export async function recordMainProcessResponsiveness(app: ElectronApplication, testInfo: TestInfo, budgetMs = 2_000) {
  const profile = await app.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __aiyE2eMainResponsiveness?: MainProcessResponsivenessProfile;
      __aiyE2eMainResponsivenessTimer?: ReturnType<typeof setInterval>;
    };
    if (runtime.__aiyE2eMainResponsivenessTimer) clearInterval(runtime.__aiyE2eMainResponsivenessTimer);
    return runtime.__aiyE2eMainResponsiveness ?? { eventLoopDelays: [] };
  });
  const maxEventLoopDelayMs = Math.max(0, ...profile.eventLoopDelays.map((entry) => entry.delay));
  const artifact = { budgetMs, maxEventLoopDelayMs, ...profile };
  await testInfo.attach('main-process-responsiveness.json', {
    body: JSON.stringify(artifact, null, 2),
    contentType: 'application/json',
  });
  expect(maxEventLoopDelayMs, `main process stalled beyond the ${budgetMs} ms foreground budget`).toBeLessThan(
    budgetMs,
  );
  return artifact;
}

export async function attachResponsiveActionResults(testInfo: TestInfo, results: ResponsiveActionResult[]) {
  await testInfo.attach('action-response-times.json', {
    body: JSON.stringify(
      results.map((result) => ({
        ...result,
        actionSettledMs: Math.round(result.actionSettledMs * 10) / 10,
        responseMs: Math.round(result.responseMs * 10) / 10,
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

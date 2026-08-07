import { expect, type Page } from '@playwright/test';
import { action, actions, activeView, view, views, type ViewName } from './selectors';

/** Waits for the preload bridge and the primary navigation, not implementation details. */
export async function expectAppReady(page: Page) {
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator(view(views.creator))).toBeVisible();
  await expect(page.locator(view(views.dictionary))).toBeVisible();
  await keepStarterPackEmpty(page);
}

export async function keepStarterPackEmpty(page: Page) {
  const keepEmpty = page.locator(action(actions.starterPackKeepEmpty));
  if (!(await keepEmpty.isVisible())) return;
  await keepEmpty.click();
  await expect(keepEmpty).toBeHidden();
}

export async function navigateTo(page: Page, name: ViewName) {
  await keepStarterPackEmpty(page);
  const target = page.locator(view(name));
  await expect(target).toBeVisible();
  await target.click();
  await expect(page.locator(activeView(name))).toBeVisible();
}

export async function reloadApp(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectAppReady(page);
}

/**
 * Settles React work without a fixed sleep. Two animation frames flush layout;
 * the bounded idle callback lets queued low-priority rendering finish.
 */
export async function waitForRendererIdle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if ('requestIdleCallback' in window) {
              window.requestIdleCallback(() => resolve(), { timeout: 250 });
            } else {
              setTimeout(resolve, 0);
            }
          });
        });
      }),
  );
}

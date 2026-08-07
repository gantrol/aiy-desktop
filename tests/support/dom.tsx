/**
 * Render helper for the component lane.
 *
 * Deliberately does *not* mock child components. The existing SSR-based tests
 * stub every child, which means they assert the shape of the mocks rather than
 * the behaviour of the tree. Render the real subtree and stub only what crosses
 * a process boundary — that boundary is `window.desktop`, the preload bridge.
 */
import type { ReactElement, ReactNode } from 'react';
import { act, render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DesktopApi, Locale } from '../../src/shared/contracts';
import { I18nContext } from '../../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './i18n';

export * from '@testing-library/react';
export { userEvent };

type DesktopApiStub = Partial<Record<keyof DesktopApi, unknown>>;

/**
 * Every unimplemented channel rejects loudly. A component that reaches for an
 * IPC route the test did not anticipate should fail the test, not quietly
 * receive `undefined` and render an empty state that looks like a pass.
 */
export function installDesktopApiStub(overrides: DesktopApiStub = {}) {
  const stub = new Proxy(overrides, {
    get(target, property: string) {
      if (property in target) return target[property as keyof DesktopApiStub];
      return () =>
        Promise.reject(
          new Error(`[dom-test] unstubbed preload channel: desktop.${property}(). Add it to installDesktopApiStub().`),
        );
    },
  });
  // The preload bridge exposes the API as `window.desktopApi`.
  Object.defineProperty(globalThis.window, 'desktopApi', { configurable: true, writable: true, value: stub });
  return stub as DesktopApi;
}

/**
 * jsdom has no layout engine, so every element measures 0x0 and virtualization
 * silently degrades to "render almost nothing". Pin a viewport size so the
 * measurement code runs for real. Returns a restore function.
 */
export function stubElementViewport({ width, height }: { width: number; height: number }) {
  const descriptors = {
    clientWidth: Object.getOwnPropertyDescriptor(globalThis.HTMLElement.prototype, 'clientWidth'),
    clientHeight: Object.getOwnPropertyDescriptor(globalThis.HTMLElement.prototype, 'clientHeight'),
  };
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    for (const [property, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis.HTMLElement.prototype, property, descriptor);
      else delete (globalThis.HTMLElement.prototype as unknown as Record<string, unknown>)[property];
    }
  };
}

/**
 * jsdom does not implement scrolling: assign the offsets, then fire the event.
 * Wrapped in `act` so the resulting state update is flushed before the caller's
 * next assertion, which is what a browser would have done by paint time.
 */
export function scrollElement(element: HTMLElement, offset: { top?: number; left?: number }) {
  act(() => {
    if (offset.top !== undefined) element.scrollTop = offset.top;
    if (offset.left !== undefined) element.scrollLeft = offset.left;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

export interface RenderComponentResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
}

/**
 * Supplies the app-level context a component would find in the real tree.
 *
 * The i18n value is injected directly rather than through `I18nProvider`,
 * because the real provider performs IPC to enumerate language packs — a
 * component test should not depend on that being stubbed correctly to render a
 * label.
 */
function Providers({ children, locale }: { children: ReactNode; locale: Locale }) {
  return <I18nContext.Provider value={testI18nValue(locale)}>{children}</I18nContext.Provider>;
}

export function renderComponent(
  ui: ReactElement,
  options: RenderOptions & { desktopApi?: DesktopApiStub; locale?: Locale } = {},
): RenderComponentResult {
  const { desktopApi, locale = 'zh', ...renderOptions } = options;
  if (desktopApi) installDesktopApiStub(desktopApi);
  const user = userEvent.setup();
  return {
    ...render(ui, {
      ...renderOptions,
      wrapper: ({ children }) => <Providers locale={locale}>{children}</Providers>,
    }),
    user,
  };
}

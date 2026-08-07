/**
 * Component-lane setup. Runs only for `*.dom.test.tsx`.
 *
 * jsdom implements the DOM, not a layout engine, so anything the product
 * measures returns zero unless it is stubbed. The stubs below are deliberately
 * dumb and deterministic: they let virtualization, masonry, and observer-driven
 * code run their real code paths. Assertions about pixel-accurate layout belong
 * in the Playwright lane, where a real compositor exists.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  if (!('matchMedia' in globalThis.window)) {
    Object.defineProperty(globalThis.window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  for (const observer of ['ResizeObserver', 'IntersectionObserver'] as const) {
    if (observer in globalThis) continue;
    Object.defineProperty(globalThis, observer, {
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    });
  }

  // Radix primitives call these during open/close transitions.
  if (!globalThis.Element.prototype.scrollIntoView) {
    globalThis.Element.prototype.scrollIntoView = vi.fn();
  }

  /**
   * jsdom ships no scrolling implementation at all. A no-op stub would let
   * scroll-driven code "pass" without ever moving, so this applies the offsets
   * and emits the event, exactly as a browser would.
   */
  if (!globalThis.Element.prototype.scrollTo) {
    const applyScroll = function applyScroll(this: Element, ...args: unknown[]) {
      const options = (
        typeof args[0] === 'object' && args[0] !== null ? args[0] : { left: args[0], top: args[1] }
      ) as ScrollToOptions;
      if (typeof options.top === 'number') this.scrollTop = options.top;
      if (typeof options.left === 'number') this.scrollLeft = options.left;
      this.dispatchEvent(new Event('scroll', { bubbles: true }));
    };
    globalThis.Element.prototype.scrollTo = applyScroll as Element['scrollTo'];
    globalThis.Element.prototype.scrollBy = function scrollBy(this: Element, ...args: unknown[]) {
      const options = (
        typeof args[0] === 'object' && args[0] !== null ? args[0] : { left: args[0], top: args[1] }
      ) as ScrollToOptions;
      applyScroll.call(this, {
        top: this.scrollTop + (options.top ?? 0),
        left: this.scrollLeft + (options.left ?? 0),
      });
    } as Element['scrollBy'];
  }
  if (!globalThis.Element.prototype.hasPointerCapture) {
    globalThis.Element.prototype.hasPointerCapture = () => false;
    globalThis.Element.prototype.setPointerCapture = vi.fn();
    globalThis.Element.prototype.releasePointerCapture = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

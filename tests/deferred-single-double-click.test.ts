import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredSingleDoubleClick } from '../src/renderer/components/albums/useDeferredSingleDoubleClick';

describe('deferred single and double click', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('defers a pointer single click', () => {
    const singleClick = vi.fn();
    const coordinator = createDeferredSingleDoubleClick(280);

    coordinator.click(1, singleClick);
    vi.advanceTimersByTime(279);
    expect(singleClick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(singleClick).toHaveBeenCalledOnce();
  });

  it('cancels the pending single click when a double click wins', () => {
    const singleClick = vi.fn();
    const doubleClick = vi.fn();
    const coordinator = createDeferredSingleDoubleClick(280);

    coordinator.click(1, singleClick);
    coordinator.click(2, singleClick);
    coordinator.doubleClick(doubleClick);
    vi.runAllTimers();

    expect(singleClick).not.toHaveBeenCalled();
    expect(doubleClick).toHaveBeenCalledOnce();
  });

  it('runs keyboard-generated clicks immediately', () => {
    const singleClick = vi.fn();
    const coordinator = createDeferredSingleDoubleClick(280);

    coordinator.click(0, singleClick);

    expect(singleClick).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

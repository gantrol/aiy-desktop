import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverIntent, HOVER_INTENT_DELAY_MS } from '../src/renderer/components/ui/use-hover-intent';

describe('hover intent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for a short pause and cancels pointer pass-through', () => {
    const action = vi.fn();
    const intent = createHoverIntent();

    intent.schedule(action);
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS - 1);
    expect(action).not.toHaveBeenCalled();

    intent.cancel();
    vi.advanceTimersByTime(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('commits only the latest intentional hover', () => {
    const first = vi.fn();
    const second = vi.fn();
    const intent = createHoverIntent();

    intent.schedule(first);
    intent.schedule(second);
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not schedule hover navigation for unsupported pointers', () => {
    const action = vi.fn();
    const intent = createHoverIntent();

    intent.schedule(action, false);
    vi.runAllTimers();

    expect(action).not.toHaveBeenCalled();
  });
});

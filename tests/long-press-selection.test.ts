import { describe, expect, it } from 'vitest';
import { longPressMovedTooFar } from '../src/renderer/components/gallery/useLongPressSelection';

describe('long-press selection movement threshold', () => {
  it('allows small pointer jitter but cancels an intentional drag', () => {
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 15, y: 16 })).toBe(false);
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 19, y: 10 })).toBe(true);
  });

  it('uses the supplied threshold', () => {
    expect(longPressMovedTooFar({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
    expect(longPressMovedTooFar({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(true);
  });
});

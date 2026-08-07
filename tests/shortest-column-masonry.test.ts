import { describe, expect, it } from 'vitest';
import { computeShortestColumnMasonry } from '../src/renderer/components/ui/shortest-column-masonry';

describe('computeShortestColumnMasonry', () => {
  it('derives responsive columns from the available width and target card width', () => {
    const items = [{ id: 'one', aspectRatio: 1 }];

    expect(computeShortestColumnMasonry(items, 744).columnCount).toBe(3);
    expect(computeShortestColumnMasonry(items, 744).columnWidth).toBe(240);
    expect(computeShortestColumnMasonry(items, 491).columnCount).toBe(1);
    expect(computeShortestColumnMasonry(items, 492).columnCount).toBe(2);
  });

  it('places each source-ordered item into the current shortest column', () => {
    const layout = computeShortestColumnMasonry(
      [
        { id: 'square-a', aspectRatio: 1 },
        { id: 'wide', aspectRatio: 2 },
        { id: 'portrait', aspectRatio: 0.5 },
        { id: 'square-b', aspectRatio: 1 },
        { id: 'square-c', aspectRatio: 1 },
      ],
      744,
    );

    expect(layout.placements.map(({ id, column, y }) => ({ id, column, y }))).toEqual([
      { id: 'square-a', column: 0, y: 0 },
      { id: 'wide', column: 1, y: 0 },
      { id: 'portrait', column: 2, y: 0 },
      { id: 'square-b', column: 1, y: 132 },
      { id: 'square-c', column: 0, y: 252 },
    ]);
    expect(layout.height).toBe(492);
  });

  it('uses source order for deterministic tie-breaking and tolerates bad dimensions', () => {
    const layout = computeShortestColumnMasonry(
      [
        { id: 'first', aspectRatio: Number.NaN },
        { id: 'second', aspectRatio: 0 },
        { id: 'third', aspectRatio: 1 },
      ],
      492,
    );

    expect(layout.placements.map((item) => item.id)).toEqual(['first', 'second', 'third']);
    expect(layout.placements.map((item) => item.column)).toEqual([0, 1, 0]);
    expect(layout.placements[0].height).toBe(180);
    expect(layout.height).toBe(432);
  });

  it('returns an empty zero-height layout without producing invalid coordinates', () => {
    expect(computeShortestColumnMasonry([], Number.NaN)).toEqual({
      columnCount: 1,
      columnWidth: 0,
      height: 0,
      placements: [],
    });
  });
});

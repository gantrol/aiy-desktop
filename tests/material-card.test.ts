import { describe, expect, it, vi } from 'vitest';
import { getMaterialCardAspectRatio } from '../src/renderer/components/gallery/MaterialCard';
import { computeMaterialMasonryLayout } from '../src/renderer/components/gallery/MaterialMasonry';
import type { MaterialLibraryItem } from '../src/renderer/components/gallery/materialLibraryTypes';
import {
  chooseMaterialOverlayTone,
  sampleMaterialOverlayTone,
} from '../src/renderer/components/gallery/materialOverlayTone';

function imageMaterial(width: number, height: number): MaterialLibraryItem {
  return {
    key: 'image:asset-1',
    kind: 'IMAGE',
    createdAt: '2026-07-29T00:00:00.000Z',
    image: {
      id: 'gallery-1',
      materialId: null,
      source: 'CREATION',
      createdAt: '2026-07-29T00:00:00.000Z',
      asset: {
        id: 'asset-1',
        kind: 'GENERATED',
        width,
        height,
        mimeType: 'image/png',
        mediaUrl: 'media://asset-1.png',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      creation: null,
      dictionary: null,
      favorite: null,
      metadata: null,
      ratings: { aesthetic: null, realism: null },
    },
  };
}

function textMaterial(text: string): MaterialLibraryItem {
  return {
    key: 'text:text-1',
    kind: 'TEXT',
    createdAt: '2026-07-29T00:00:00.000Z',
    text: {
      id: 'text-1',
      text,
      createdAt: '2026-07-29T00:00:00.000Z',
      favoritedAt: '2026-07-29T00:00:00.000Z',
    },
  };
}

describe('material card visual helpers', () => {
  it('chooses black text only for consistently bright overlay pixels', () => {
    const bright = new Uint8ClampedArray([245, 245, 245, 255, 255, 255, 255, 255, 235, 235, 235, 255]);
    const dark = new Uint8ClampedArray([12, 18, 24, 255, 35, 42, 48, 255, 80, 72, 64, 255]);

    expect(chooseMaterialOverlayTone(bright)).toBe('dark');
    expect(chooseMaterialOverlayTone(dark)).toBe('light');
    expect(chooseMaterialOverlayTone(new Uint8ClampedArray())).toBe('light');
  });

  it('falls back to light text when the image scheme blocks canvas reads', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => {
            throw new DOMException('Canvas is tainted', 'SecurityError');
          },
        }),
      }),
    });

    try {
      expect(sampleMaterialOverlayTone({ naturalWidth: 1200, naturalHeight: 1600 } as HTMLImageElement)).toBe('light');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves image dimensions without clamping portrait or panorama ratios', () => {
    expect(getMaterialCardAspectRatio(imageMaterial(300, 1200))).toBe(0.25);
    expect(getMaterialCardAspectRatio(imageMaterial(2400, 400))).toBe(6);
    expect(getMaterialCardAspectRatio(imageMaterial(0, 0))).toBe(4 / 3);
  });

  it('gives longer text materials progressively more reading height', () => {
    expect(getMaterialCardAspectRatio(textMaterial('short note'))).toBe(4 / 3);
    expect(getMaterialCardAspectRatio(textMaterial('x'.repeat(80)))).toBe(1);
    expect(getMaterialCardAspectRatio(textMaterial('x'.repeat(180)))).toBe(4 / 5);
  });
});

describe('computeMaterialMasonryLayout', () => {
  it('places every next card in the currently shortest column', () => {
    const layout = computeMaterialMasonryLayout(
      [
        { id: 'square-a', aspectRatio: 1 },
        { id: 'wide', aspectRatio: 2 },
        { id: 'portrait', aspectRatio: 0.5 },
        { id: 'square-b', aspectRatio: 1 },
        { id: 'square-c', aspectRatio: 1 },
      ],
      684,
    );

    expect(layout.columnCount).toBe(3);
    expect(layout.columnWidth).toBe(220);
    expect(layout.placements.map(({ id, column, y }) => ({ id, column, y }))).toEqual([
      { id: 'square-a', column: 0, y: 0 },
      { id: 'wide', column: 1, y: 0 },
      { id: 'portrait', column: 2, y: 0 },
      { id: 'square-b', column: 1, y: 122 },
      { id: 'square-c', column: 0, y: 232 },
    ]);
    expect(layout.height).toBe(452);
  });

  it('stays deterministic with invalid ratios and empty input', () => {
    const layout = computeMaterialMasonryLayout(
      [
        { id: 'first', aspectRatio: Number.NaN },
        { id: 'second', aspectRatio: 0 },
        { id: 'third', aspectRatio: 1 },
      ],
      452,
    );

    expect(layout.columnCount).toBe(2);
    expect(layout.placements.map((item) => item.column)).toEqual([0, 1, 0]);
    expect(computeMaterialMasonryLayout([], Number.NaN)).toEqual({
      columnCount: 1,
      columnWidth: 0,
      height: 0,
      placements: [],
    });
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AssetDto } from '../src/shared/contracts';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackLeadingEdge,
  MediaStackPreview,
} from '../src/renderer/components/media/MediaStackPreview';

function asset(id: string, width = 1200, height = 1600): AssetDto {
  return {
    id,
    kind: 'GENERATED',
    originType: 'TEST',
    objectHash: `hash-${id}`,
    mediaUrl: `asset://${id}`,
    width,
    height,
    mimeType: 'image/png',
    byteSize: 1,
    createdAt: '2026-07-31T00:00:00.000Z',
  } as AssetDto;
}

describe('media stack preview', () => {
  it('renders at most five uncropped tree covers while retaining the source item count', () => {
    const markup = renderToStaticMarkup(
      createElement(MediaStackPreview, {
        size: 'tree',
        items: [asset('a'), asset('b'), asset('c'), asset('d'), asset('e'), asset('f')].map((item) => ({
          asset: item,
        })),
        maxItems: 5,
      }),
    );

    expect(markup).toContain('data-media-stack="true"');
    expect(markup).toContain('data-media-count="6"');
    expect(markup.match(/<img/g)).toHaveLength(5);
    expect(markup).toContain('object-contain');

    const ordinaryTree = renderToStaticMarkup(
      createElement(MediaStackPreview, {
        size: 'tree',
        items: [asset('a'), asset('b'), asset('c'), asset('d')].map((item) => ({ asset: item })),
      }),
    );
    expect(ordinaryTree.match(/<img/g)).toHaveLength(3);
  });

  it('makes the tree presentation about one and a half times the compact presentation', () => {
    for (const property of ['containerWidth', 'containerHeight'] as const) {
      const ratio = getMediaStackLayout('tree')[property] / getMediaStackLayout('xs')[property];
      expect(ratio, property).toBeGreaterThanOrEqual(1.35);
      expect(ratio, property).toBeLessThanOrEqual(1.65);
    }
  });

  it('moves the attached disclosure edge from the same controlled expansion state', () => {
    const items = [asset('a'), asset('b'), asset('c')].map((item) => ({ asset: item }));
    const collapsedEdge = getMediaStackLeadingEdge('tree', items, false);
    const expandedEdge = getMediaStackLeadingEdge('tree', items, true);
    expect(Number.isFinite(collapsedEdge)).toBe(true);
    expect(Number.isFinite(expandedEdge)).toBe(true);
    expect(expandedEdge).not.toBe(collapsedEdge);

    const collapsed = renderToStaticMarkup(createElement(MediaStackPreview, { size: 'tree', items, expanded: false }));
    const expanded = renderToStaticMarkup(createElement(MediaStackPreview, { size: 'tree', items, expanded: true }));
    expect(expanded).not.toBe(collapsed);
  });

  it('allows album covers to opt into a wider expanded fan', () => {
    const items = [asset('a'), asset('b'), asset('c')].map((item) => ({ asset: item }));
    const standard = renderToStaticMarkup(
      createElement(MediaStackPreview, {
        size: 'tree',
        items,
        spread: 'expanded',
      }),
    );
    const wider = renderToStaticMarkup(
      createElement(MediaStackPreview, {
        size: 'tree',
        items,
        spread: 'expanded',
        expandedStep: 24,
      }),
    );

    expect(wider).not.toBe(standard);
    const positions = [...wider.matchAll(/translateX\(([-\d.]+)px\)/g)].map((match) => Number(match[1]));
    expect(positions[1] - positions[0]).toBe(24);

    const bounds = getMediaStackHorizontalBounds('tree', items, 'expanded', 5, 24);
    expect(bounds.right).toBeGreaterThan(getMediaStackLayout('tree').containerWidth);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = path.resolve(__dirname, '../src/renderer/components');

function readComponent(relativePath: string) {
  return fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
}

describe('gallery media visual contract', () => {
  const files = ['gallery/MaterialCard.tsx', 'gallery/GalleryTile.tsx', 'media/MediaStackPreview.tsx'];

  it('keeps persistent cards and thumbnails flat and uncropped', () => {
    for (const file of files) {
      const source = readComponent(file);
      expect(source, file).not.toMatch(/\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/);
      expect(source, file).not.toMatch(/hover:(?:-?translate|scale)-/);
      expect(source, file).not.toContain('object-cover');
      expect(source, file).toContain('object-contain');
      expect(source, file).toContain('media-surround');
    }
  });

  it('uses semantic colors instead of fixed overlay and favorite palettes', () => {
    for (const file of files) {
      const source = readComponent(file);
      expect(source, file).not.toMatch(/(?:bg|text|from|via|to)-(?:black|white|rose)(?:\b|\/)/);
    }
    const materialCard = readComponent('gallery/MaterialCard.tsx');
    expect(materialCard).toContain('text-relation-favorited');
    expect(materialCard).toContain('text-relation-referenced');
    expect(materialCard).not.toContain('bg-gradient');
  });

  it('keeps image metadata visible until pointer hover while preserving it for keyboard focus', () => {
    const materialCard = readComponent('gallery/MaterialCard.tsx');
    const overlay = materialCard.slice(materialCard.indexOf('data-material-overlay'));
    expect(materialCard).toContain('sampleMaterialCardOverlay(event.currentTarget)');
    expect(materialCard).toContain('group/card-button');
    expect(materialCard).toContain('group-hover/card-button:scale-[1.015]');
    expect(materialCard).toContain('motion-reduce:transform-none');
    expect(materialCard.match(/group-hover\/card-button:scale-\[1\.015\]/g)).toHaveLength(1);
    expect(materialCard).not.toContain('data-material-hover-shade');
    expect(overlay).toContain('data-material-overlay-tone={overlayTone}');
    expect(overlay).not.toContain('bg-overlay/95');
    expect(overlay).toContain('transition-[color,opacity]');
    expect(overlay).toContain('duration-base');
    expect(overlay).toContain('group-hover/card-button:duration-fast');
    expect(overlay).toContain('group-hover/card-button:ease-exit');
    expect(overlay).toContain('motion-reduce:transition-none');
    expect(overlay).toContain('group-hover/card-button:opacity-0');
    expect(overlay).toContain('group-focus-visible/card-button:opacity-100');
    // The contract is the pairing, not the count: anything that hides on pointer
    // hover must come back for keyboard focus, or metadata becomes unreachable
    // without a mouse. Counting occurrences instead pinned the assertion to one
    // particular markup shape and broke when two overlays were consolidated.
    const hidesOnHover = materialCard.match(/group-hover\/card-button:opacity-0/g) ?? [];
    const restoresOnFocus = materialCard.match(/group-focus-visible\/card-button:opacity-100/g) ?? [];
    expect(hidesOnHover.length).toBeGreaterThan(0);
    expect(restoresOnFocus).toHaveLength(hidesOnHover.length);
    expect(materialCard).toContain('aria-pressed={selected || checked}');
  });
});

describe('persistent workbench visual contract', () => {
  const persistentFiles = [
    'gallery/GallerySourceTabs.tsx',
    'spaces/LocalSpaceSwitcher.tsx',
    'creator/CreationMaterialPicker.tsx',
    'creator/PairComparisonView.tsx',
    'gallery/AlbumNavigation.tsx',
    'creator/ResultLibrary.tsx',
  ];

  it('keeps persistent navigation, lists, and thumbnails flat', () => {
    for (const file of persistentFiles) {
      const source = readComponent(file);
      expect(source, file).not.toMatch(/\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/);
      expect(source, file).not.toMatch(/hover:(?:-?translate|scale)-/);
      expect(source, file).not.toContain('object-cover');
    }
  });

  it('uses the shared segmented primitive for gallery source filters', () => {
    const source = readComponent('gallery/GallerySourceTabs.tsx');
    expect(source).toContain('<Segmented');
    expect(source).toContain('<SegmentedItem');
    expect(source).not.toContain('<Button');
  });

  it('uses semantic media and selection treatments', () => {
    for (const file of [
      'creator/CreationMaterialPicker.tsx',
      'creator/PairComparisonView.tsx',
      'gallery/AlbumNavigation.tsx',
      'creator/ResultLibrary.tsx',
    ]) {
      const source = readComponent(file);
      expect(
        source.includes('media-surround') ||
          source.includes('MediaStackPreview') ||
          source.includes('AlbumTreePreview'),
        file,
      ).toBe(true);
    }
    for (const file of [
      'spaces/LocalSpaceSwitcher.tsx',
      'creator/CreationMaterialPicker.tsx',
      'gallery/AlbumNavigation.tsx',
      'creator/ResultLibrary.tsx',
    ]) {
      expect(readComponent(file), file).toMatch(/(?:bg|border|text)-selected/);
    }
  });

  it('keeps the material search focus treatment visible and opaque', () => {
    const source = readComponent('creator/CreationMaterialPicker.tsx');
    expect(source).not.toContain('focus-visible:ring-0');
    expect(source).toContain('focus-visible:ring-inset');
    expect(source).toContain('focus-visible:ring-ring');
  });
});

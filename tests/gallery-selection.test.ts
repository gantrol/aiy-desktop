import { describe, expect, it } from 'vitest';
import { clearGallerySelection, nextGallerySelection } from '../src/renderer/components/gallery/gallerySelection';

const keys = ['a', 'b', 'c', 'd'];

describe('gallery batch selection', () => {
  it('toggles individual items with Ctrl or Cmd semantics', () => {
    const first = nextGallerySelection(keys, clearGallerySelection(), 'b', { toggle: true });
    expect([...first.checkedKeys]).toEqual(['b']);
    expect(first.selectedKey).toBeNull();
    const second = nextGallerySelection(keys, first, 'b', { toggle: true });
    expect([...second.checkedKeys]).toEqual([]);
  });

  it('selects an inclusive range in either direction', () => {
    const anchored = nextGallerySelection(keys, clearGallerySelection(), 'd');
    const ranged = nextGallerySelection(keys, anchored, 'b', { range: true });
    expect([...ranged.checkedKeys]).toEqual(['b', 'c', 'd']);
    expect(ranged.anchorKey).toBe('d');
  });

  it('plain selection leaves batch mode and clear resets every selection field', () => {
    const checked = nextGallerySelection(keys, clearGallerySelection(), 'a', { toggle: true });
    const selected = nextGallerySelection(keys, checked, 'c');
    expect(selected.selectedKey).toBe('c');
    expect(selected.checkedKeys.size).toBe(0);
    expect(clearGallerySelection()).toEqual({ selectedKey: null, checkedKeys: new Set(), anchorKey: null });
  });
});

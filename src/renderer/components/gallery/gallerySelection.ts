import type { SelectionModifiers } from '@/renderer/components/gallery/materialLibraryTypes';

export interface GallerySelectionState {
  selectedKey: string | null;
  checkedKeys: ReadonlySet<string>;
  anchorKey: string | null;
}

export function nextGallerySelection(
  orderedKeys: readonly string[],
  state: GallerySelectionState,
  targetKey: string,
  modifiers: Partial<SelectionModifiers> = {},
): GallerySelectionState {
  if (modifiers.range && state.anchorKey) {
    const anchorIndex = orderedKeys.indexOf(state.anchorKey);
    const targetIndex = orderedKeys.indexOf(targetKey);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const from = Math.min(anchorIndex, targetIndex);
      const to = Math.max(anchorIndex, targetIndex);
      return { selectedKey: null, checkedKeys: new Set(orderedKeys.slice(from, to + 1)), anchorKey: state.anchorKey };
    }
  }
  if (modifiers.toggle) {
    const checkedKeys = new Set(state.checkedKeys);
    if (checkedKeys.has(targetKey)) checkedKeys.delete(targetKey);
    else checkedKeys.add(targetKey);
    return { selectedKey: null, checkedKeys, anchorKey: targetKey };
  }
  return { selectedKey: targetKey, checkedKeys: new Set(), anchorKey: targetKey };
}

export function clearGallerySelection(): GallerySelectionState {
  return { selectedKey: null, checkedKeys: new Set(), anchorKey: null };
}

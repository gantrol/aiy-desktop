import type { FavoriteTextMaterialDto, GalleryItemDto } from '@/shared/contracts';

export type MaterialLibraryItem =
  | { key: string; kind: 'IMAGE'; createdAt: string; image: GalleryItemDto }
  | { key: string; kind: 'TEXT'; createdAt: string; text: FavoriteTextMaterialDto };

/** Which multi-select gesture a click carried: shift extends, ctrl/cmd toggles. */
export interface SelectionModifiers {
  range: boolean;
  toggle: boolean;
}

export function selectionModifiers(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): SelectionModifiers {
  return { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey };
}

// Gallery list updates replace only the rows that actually changed, so caching
// the wrapper by source row keeps every untouched card referentially equal and
// lets memoized cards skip the re-render.
const imageMaterials = new WeakMap<GalleryItemDto, MaterialLibraryItem>();
const textMaterials = new WeakMap<FavoriteTextMaterialDto, MaterialLibraryItem>();

export function imageMaterial(item: GalleryItemDto): MaterialLibraryItem {
  const cached = imageMaterials.get(item);
  if (cached) return cached;
  const created: MaterialLibraryItem = {
    key: `image:${item.asset.id}`,
    kind: 'IMAGE',
    createdAt: item.createdAt,
    image: item,
  };
  imageMaterials.set(item, created);
  return created;
}

export function textMaterial(item: FavoriteTextMaterialDto): MaterialLibraryItem {
  const cached = textMaterials.get(item);
  if (cached) return cached;
  const created: MaterialLibraryItem = {
    key: `text:${item.id}`,
    kind: 'TEXT',
    createdAt: item.createdAt,
    text: item,
  };
  textMaterials.set(item, created);
  return created;
}

function fileStem(value: string) {
  const name = value.trim().split(/[\\/]/).at(-1) ?? '';
  return name.replace(/\.[^.]+$/, '').trim();
}

export function materialTitle(item: MaterialLibraryItem, fallback: string) {
  if (item.kind === 'TEXT') {
    return item.text.text.split(/\r?\n/, 1)[0]?.trim() || fallback;
  }
  if (item.image.metadata?.displayName.trim()) return item.image.metadata.displayName.trim();
  return (
    item.image.creation?.seriesTitle ||
    item.image.dictionary?.termName ||
    fileStem(item.image.metadata?.originalName ?? '') ||
    fallback
  );
}

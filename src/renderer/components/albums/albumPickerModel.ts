import type { ContentAlbumOption } from '@/shared/content-album-options';

export interface AlbumPickerOption extends ContentAlbumOption {
  disabled?: boolean;
}

export interface AlbumPickerRow extends AlbumPickerOption {
  path: string;
  parentPath: string;
  searchTitle: string;
  searchPath: string;
}

export function normalizeAlbumSearch(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

/** Preserve source order; promote orphaned nodes and break cycles so every option remains reachable. */
export function buildAlbumPickerIndex(options: readonly AlbumPickerOption[]) {
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const children = new Map<string | null, AlbumPickerOption[]>();
  for (const option of optionsById.values()) {
    const parent = option.parentId !== option.id && optionsById.has(option.parentId ?? '') ? option.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(option);
    children.set(parent, siblings);
  }
  const byId = new Map<string, AlbumPickerRow>();
  const childrenById = new Map<string | null, AlbumPickerRow[]>();
  const rows: AlbumPickerRow[] = [];
  const append = (root: AlbumPickerOption) => {
    const pending: { option: AlbumPickerOption; parent: AlbumPickerRow | null }[] = [{ option: root, parent: null }];
    while (pending.length) {
      const { option, parent } = pending.pop()!;
      if (byId.has(option.id)) continue;
      const path = parent ? `${parent.path} / ${option.title}` : option.title;
      const row: AlbumPickerRow = {
        ...option,
        parentId: parent?.id ?? null,
        parentPath: parent?.path ?? '',
        path,
        searchTitle: normalizeAlbumSearch(option.title),
        searchPath: normalizeAlbumSearch(path),
      };
      byId.set(row.id, row);
      rows.push(row);
      const siblings = childrenById.get(row.parentId) ?? [];
      siblings.push(row);
      childrenById.set(row.parentId, siblings);
      const descendants = children.get(row.id) ?? [];
      for (let i = descendants.length - 1; i >= 0; i--) pending.push({ option: descendants[i], parent: row });
    }
  };
  for (const root of children.get(null) ?? []) append(root);
  for (const option of optionsById.values()) if (!byId.has(option.id)) append(option);
  return { byId, childrenById, rows };
}

export type AlbumPickerIndex = ReturnType<typeof buildAlbumPickerIndex>;

export function searchAlbumPicker(index: AlbumPickerIndex, query: string) {
  const search = normalizeAlbumSearch(query);
  const matches = index.rows.filter((row) => row.searchPath.includes(search));
  const rank = (row: AlbumPickerRow) =>
    row.searchTitle.startsWith(search) ? 0 : row.searchTitle.includes(search) ? 1 : 2;
  return matches.sort((left, right) => rank(left) - rank(right));
}

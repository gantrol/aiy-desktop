import type { MaterialAlbumDto } from '@/shared/contracts';

export interface MaterialAlbumTreeIndex {
  byId: Map<string, MaterialAlbumDto>;
  parentById: Map<string, string>;
  roots: MaterialAlbumDto[];
  childrenByParentId: Map<string, MaterialAlbumDto[]>;
}

export interface MaterialAlbumTreeRow {
  album: MaterialAlbumDto;
  depth: number;
}

export function canMoveMaterialAlbumTo(tree: MaterialAlbumTreeIndex, albumId: string, parentAlbumId: string | null) {
  const source = tree.byId.get(albumId);
  if (source?.kind !== 'USER') return false;
  if (parentAlbumId === null) return source.parentId !== null;
  if (source.parentId === parentAlbumId || tree.byId.get(parentAlbumId)?.kind !== 'USER') return false;
  const visited = new Set<string>();
  let currentId: string | undefined = parentAlbumId;
  while (currentId) {
    if (currentId === albumId || visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = tree.parentById.get(currentId);
  }
  return true;
}

/** Builds the material-album hierarchy from its explicit parent IDs. */
export function buildMaterialAlbumTree(albums: readonly MaterialAlbumDto[]): MaterialAlbumTreeIndex {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const parentById = new Map<string, string>();
  const childrenByParentId = new Map<string, MaterialAlbumDto[]>();
  const roots: MaterialAlbumDto[] = [];

  for (const album of albums) {
    const parentId = album.parentId;
    if (parentId && parentId !== album.id && byId.has(parentId)) {
      parentById.set(album.id, parentId);
      const children = childrenByParentId.get(parentId) ?? [];
      children.push(album);
      childrenByParentId.set(parentId, children);
    } else {
      roots.push(album);
    }
  }

  return { byId, parentById, roots, childrenByParentId };
}

/** Produces stable, depth-aware rows and still surfaces orphaned/cyclic data. */
export function flattenMaterialAlbumTree(index: MaterialAlbumTreeIndex): MaterialAlbumTreeRow[] {
  const rows: MaterialAlbumTreeRow[] = [];
  const visited = new Set<string>();

  function append(album: MaterialAlbumDto, depth: number) {
    if (visited.has(album.id)) return;
    visited.add(album.id);
    rows.push({ album, depth });
    for (const child of index.childrenByParentId.get(album.id) ?? []) append(child, depth + 1);
  }

  for (const root of index.roots) append(root, 0);
  for (const album of index.byId.values()) append(album, 0);
  return rows;
}

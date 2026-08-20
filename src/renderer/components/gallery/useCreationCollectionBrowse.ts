import { useMemo } from 'react';
import type { CreationRelationFilter, MaterialAlbumDto } from '@/shared/contracts';
import { buildMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';

interface Options {
  albums: readonly MaterialAlbumDto[];
  activeAlbum: MaterialAlbumDto | null;
  favoriteOnly: boolean;
  query: string;
  relation: CreationRelationFilter;
  unratedActive: boolean;
}

function creationPath(activeAlbum: MaterialAlbumDto, albums: readonly MaterialAlbumDto[]) {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current: MaterialAlbumDto | undefined = activeAlbum;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.length > 1 ? path.join(' / ') : undefined;
}

export function useCreationCollectionBrowse(options: Options) {
  const { albums, activeAlbum, favoriteOnly, query, relation, unratedActive } = options;
  return useMemo(() => {
    const creationAlbums = albums.filter((album) => album.systemKey?.startsWith('CREATION_'));
    const tree = buildMaterialAlbumTree(creationAlbums);
    const root = creationAlbums.find((album) => album.systemKey === 'CREATION_ROOT') ?? null;
    const rootCollections = root ? (tree.childrenByParentId.get(root.id) ?? []) : [];
    const scopeActive = Boolean(activeAlbum?.systemKey?.startsWith('CREATION_'));
    if (!activeAlbum || !scopeActive) {
      return { scopeActive: false, browseActive: false, collections: null, rootCollections, path: undefined };
    }
    const browseActive =
      activeAlbum.systemKey !== 'CREATION_SERIES' && !favoriteOnly && !query && relation === 'ALL' && !unratedActive;
    return {
      scopeActive,
      browseActive,
      collections: browseActive ? (tree.childrenByParentId.get(activeAlbum.id) ?? []) : null,
      rootCollections,
      path: creationPath(activeAlbum, albums),
    };
  }, [activeAlbum, albums, favoriteOnly, query, relation, unratedActive]);
}

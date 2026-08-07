import type { AlbumDto } from '@/shared/contracts';

export interface AlbumTreeIndex {
  byId: Map<string, AlbumDto>;
  parentById: Map<string, string>;
  childrenByParentId: Map<string, AlbumDto[]>;
  activeRoots: AlbumDto[];
  archivedRoots: AlbumDto[];
  effectivelyArchived: Set<string>;
}

export interface AlbumTreeRow {
  album: AlbumDto;
  depth: number;
}

export function compareAlbumActivity(left: AlbumDto, right: AlbumDto) {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.activityAt.localeCompare(left.activityAt) ||
    left.id.localeCompare(right.id)
  );
}

export function compareSidebarRootSortOrder(
  leftOrder: number | null | undefined,
  rightOrder: number | null | undefined,
) {
  // Roots without an explicit position form a leading recency lane. This keeps
  // newly created work visible until the user gives it a position by dragging it.
  if (leftOrder == null && rightOrder != null) return -1;
  if (leftOrder != null && rightOrder == null) return 1;
  if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder;
  return 0;
}

export function compareAlbumRootOrder(left: AlbumDto, right: AlbumDto, scope: 'creator' | 'gallery') {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned) return pinned;
  const leftOrder = scope === 'creator' ? left.creatorRootSortOrder : left.galleryRootSortOrder;
  const rightOrder = scope === 'creator' ? right.creatorRootSortOrder : right.galleryRootSortOrder;
  const rootOrder = compareSidebarRootSortOrder(leftOrder, rightOrder);
  if (rootOrder) return rootOrder;
  return compareAlbumActivity(left, right);
}

export function buildAlbumTreeIndex(
  albums: readonly AlbumDto[],
  parentOverrides: ReadonlyMap<string, string | null> = new Map(),
  rootOrderScope: 'creator' | 'gallery' = 'creator',
): AlbumTreeIndex {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const parentById = new Map<string, string>();
  const childOrderByParentId = new Map<string, Map<string, number>>();
  for (const parent of albums) {
    const childOrder = new Map<string, number>();
    for (const member of parent.members) {
      if (member.targetType !== 'ALBUM' || !byId.has(member.targetId)) continue;
      childOrder.set(member.targetId, member.sortOrder);
      if (parentById.has(member.targetId)) continue;
      parentById.set(member.targetId, parent.id);
    }
    childOrderByParentId.set(parent.id, childOrder);
  }
  for (const [albumId, parentId] of parentOverrides) {
    if (!byId.has(albumId)) continue;
    if (parentId && byId.has(parentId) && parentId !== albumId) parentById.set(albumId, parentId);
    else parentById.delete(albumId);
  }

  const childrenByParentId = new Map<string, AlbumDto[]>();
  for (const album of albums) {
    const parentId = parentById.get(album.id);
    if (!parentId) continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(album);
    childrenByParentId.set(parentId, children);
  }
  for (const [parentId, children] of childrenByParentId) {
    const order = childOrderByParentId.get(parentId);
    children.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        (order?.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order?.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        compareAlbumActivity(left, right),
    );
  }

  const effectivelyArchived = new Set<string>();
  function isArchived(albumId: string, visited = new Set<string>()): boolean {
    if (effectivelyArchived.has(albumId)) return true;
    if (visited.has(albumId)) return false;
    visited.add(albumId);
    const album = byId.get(albumId);
    const parentId = parentById.get(albumId);
    const archived = Boolean(album?.archivedAt) || Boolean(parentId && isArchived(parentId, visited));
    if (archived) effectivelyArchived.add(albumId);
    return archived;
  }
  for (const album of albums) isArchived(album.id);

  const activeRoots = albums
    .filter((album) => !parentById.has(album.id) && !effectivelyArchived.has(album.id))
    .sort((left, right) => compareAlbumRootOrder(left, right, rootOrderScope));
  const archivedRoots = albums
    .filter((album) => effectivelyArchived.has(album.id))
    .filter((album) => {
      const parentId = parentById.get(album.id);
      return !parentId || !effectivelyArchived.has(parentId);
    })
    .sort((left, right) => compareAlbumRootOrder(left, right, rootOrderScope));

  return { byId, parentById, childrenByParentId, activeRoots, archivedRoots, effectivelyArchived };
}

export function flattenAlbumTree(index: AlbumTreeIndex, roots = index.activeRoots): AlbumTreeRow[] {
  const rows: AlbumTreeRow[] = [];
  const visited = new Set<string>();
  function append(album: AlbumDto, depth: number) {
    if (visited.has(album.id)) return;
    visited.add(album.id);
    rows.push({ album, depth });
    for (const child of index.childrenByParentId.get(album.id) ?? []) {
      if (!index.effectivelyArchived.has(child.id)) append(child, depth + 1);
    }
  }
  for (const root of roots) append(root, 0);
  return rows;
}

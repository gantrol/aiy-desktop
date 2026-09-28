import type { AlbumDto } from '@/shared/contracts';
import type { ContentAlbumOption } from '@/shared/content-album-options';
import { buildAlbumTreeIndex, flattenAlbumTree } from '@/renderer/components/albums/albumTree';

export function creationAlbumOptions(albums: readonly AlbumDto[]): ContentAlbumOption[] {
  const tree = buildAlbumTreeIndex(albums);
  const ordered = flattenAlbumTree(tree).map(({ album }) => album);
  const included = new Set(ordered.map((album) => album.id));
  // Leave cycle repair to the picker model without losing unarchived options outside valid roots.
  ordered.push(...albums.filter((album) => !included.has(album.id) && !tree.effectivelyArchived.has(album.id)));
  return ordered.map((album) => ({
    id: album.id,
    title: album.title,
    parentId: tree.parentById.get(album.id) ?? null,
  }));
}

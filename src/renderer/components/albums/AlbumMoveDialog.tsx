import { useMemo } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { buildAlbumTreeIndex, flattenAlbumTree } from '@/renderer/components/albums/albumTree';
import { AlbumMoveDestinationDialog } from '@/renderer/components/albums/AlbumMoveDestinationDialog';

export interface AlbumMoveTarget {
  kind: 'ALBUM' | 'CREATION' | 'DOCUMENT' | 'STASH' | 'POST' | 'ARTICLE';
  id: string;
  title: string;
  currentAlbumId: string | null;
}

interface Labels {
  title: string;
  topLevel: string;
  operationFailed: string;
}

interface Props {
  albums: readonly AlbumDto[];
  target: AlbumMoveTarget | null;
  labels: Labels;
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onMove(albumId: string | null): Promise<void>;
}

function blockedAlbumDestinations(target: AlbumMoveTarget | null, tree: ReturnType<typeof buildAlbumTreeIndex>) {
  const blocked = new Set<string>();
  if (target?.kind !== 'ALBUM') return blocked;
  const pending = [target.id];
  while (pending.length > 0) {
    const albumId = pending.pop();
    if (!albumId || blocked.has(albumId)) continue;
    blocked.add(albumId);
    for (const child of tree.childrenByParentId.get(albumId) ?? []) pending.push(child.id);
  }
  return blocked;
}

/** Shared, keyboard-accessible destination picker for album trees. */
export function AlbumMoveDialog({ albums, target, labels, busy = false, onOpenChange, onMove }: Props) {
  const tree = useMemo(() => buildAlbumTreeIndex(albums), [albums]);
  const blocked = useMemo(() => blockedAlbumDestinations(target, tree), [target, tree]);
  const rows = useMemo(
    () =>
      flattenAlbumTree(tree)
        .filter(({ album }) => !blocked.has(album.id))
        .map(({ album, depth }) => ({ id: album.id, title: album.title, depth })),
    [blocked, tree],
  );
  return (
    <AlbumMoveDestinationDialog
      rows={rows}
      target={target}
      labels={labels}
      busy={busy}
      onOpenChange={onOpenChange}
      onMove={onMove}
    />
  );
}

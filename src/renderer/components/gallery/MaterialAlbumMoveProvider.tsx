import { FolderInputIcon } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { AlbumMoveDestinationDialog } from '@/renderer/components/albums/AlbumMoveDestinationDialog';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import {
  buildMaterialAlbumTree,
  canMoveMaterialAlbumTo,
  flattenMaterialAlbumTree,
} from '@/renderer/components/gallery/materialAlbumTree';
import { useI18n } from '@/renderer/i18n/useI18n';

const MaterialAlbumMoveContext = createContext<{
  busy: boolean;
  requestMove(albumId: string): void;
} | null>(null);

interface Props {
  albums: readonly MaterialAlbumDto[];
  busy: boolean;
  onMove(albumId: string, parentAlbumId: string | null): Promise<void>;
  children: ReactNode;
}

export function MaterialAlbumMoveProvider({ albums, busy, onMove, children }: Props) {
  const labels = useI18n().messages.gallery.albums;
  const [targetId, setTargetId] = useState<string | null>(null);
  const tree = useMemo(() => buildMaterialAlbumTree(albums.filter((album) => album.kind === 'USER')), [albums]);
  const target = targetId ? tree.byId.get(targetId) : undefined;
  const rows = useMemo(
    () =>
      target
        ? flattenMaterialAlbumTree(tree)
            .filter(({ album }) => album.id === target.parentId || canMoveMaterialAlbumTo(tree, target.id, album.id))
            .map(({ album, depth }) => ({ id: album.id, title: album.title, depth }))
        : [],
    [target, tree],
  );
  const context = useMemo(
    () => ({
      busy,
      requestMove(albumId: string) {
        if (!busy && tree.byId.has(albumId)) setTargetId(albumId);
      },
    }),
    [busy, tree],
  );

  return (
    <MaterialAlbumMoveContext.Provider value={context}>
      {children}
      <AlbumMoveDestinationDialog
        rows={rows}
        target={target ? { id: target.id, title: target.title, currentAlbumId: target.parentId } : null}
        labels={{ title: labels.moveTitle, topLevel: labels.moveToRoot, operationFailed: labels.operationFailed }}
        busy={busy}
        onOpenChange={(open) => !open && setTargetId(null)}
        onMove={async (parentAlbumId) => {
          if (!target || !canMoveMaterialAlbumTo(tree, target.id, parentAlbumId)) {
            throw new Error(labels.operationFailed);
          }
          await onMove(target.id, parentAlbumId);
        }}
      />
    </MaterialAlbumMoveContext.Provider>
  );
}

export function useMaterialAlbumMoveActions(album: MaterialAlbumDto, busy: boolean): ActionMenuAction[] {
  const move = useContext(MaterialAlbumMoveContext);
  const labels = useI18n().messages.gallery.albums;
  if (!move || album.kind !== 'USER') return [];
  return [
    {
      id: 'move-album',
      label: labels.move,
      icon: FolderInputIcon,
      disabled: busy || move.busy,
      onSelect: () => move.requestMove(album.id),
    },
  ];
}

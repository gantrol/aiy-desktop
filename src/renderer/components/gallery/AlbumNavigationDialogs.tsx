import type { AlbumDto } from '@/shared/contracts';
import { AlbumMoveDialog } from '@/renderer/components/albums/AlbumMoveDialog';
import { AlbumEditorDialog, DeleteAlbumDialog } from '@/renderer/components/gallery/AlbumDialogs';
import type { AlbumEditorState, AlbumNavigationLabels } from '@/renderer/components/gallery/AlbumNavigation';

interface Props {
  albums: AlbumDto[];
  editor: AlbumEditorState | null;
  deleteAlbum: AlbumDto | null;
  moveAlbumTarget: AlbumDto | null;
  moveCurrentAlbumId: string | null;
  labels: AlbumNavigationLabels;
  busy: boolean;
  onEditorClose(): void;
  onDeleteClose(): void;
  onMoveClose(): void;
  onCreate(title: string, parentAlbumId: string | null): Promise<void>;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onMove(albumId: string, parentAlbumId: string | null): Promise<void>;
}

export function AlbumNavigationDialogs({
  albums,
  editor,
  deleteAlbum,
  moveAlbumTarget,
  moveCurrentAlbumId,
  labels,
  busy,
  onEditorClose,
  onDeleteClose,
  onMoveClose,
  onCreate,
  onRename,
  onDelete,
  onMove,
}: Props) {
  return (
    <>
      <AlbumEditorDialog
        state={editor}
        labels={labels}
        busy={busy}
        onOpenChange={(open) => !open && onEditorClose()}
        onSubmit={async (title) => {
          if (!editor) return;
          if (editor.mode === 'create') await onCreate(title, editor.parent?.id ?? null);
          else await onRename(editor.album, title);
          onEditorClose();
        }}
      />
      <DeleteAlbumDialog
        album={deleteAlbum}
        labels={labels}
        busy={busy}
        onOpenChange={(open) => !open && onDeleteClose()}
        onDelete={async () => {
          if (!deleteAlbum) return;
          await onDelete(deleteAlbum);
          onDeleteClose();
        }}
      />
      <AlbumMoveDialog
        albums={albums}
        target={
          moveAlbumTarget
            ? {
                kind: 'ALBUM',
                id: moveAlbumTarget.id,
                title: moveAlbumTarget.title,
                currentAlbumId: moveCurrentAlbumId,
              }
            : null
        }
        labels={{
          title: labels.moveTitle,
          topLevel: labels.moveToRoot,
          operationFailed: labels.operationFailed,
        }}
        busy={busy}
        onOpenChange={(open) => !open && onMoveClose()}
        onMove={async (parentAlbumId) => {
          if (moveAlbumTarget) await onMove(moveAlbumTarget.id, parentAlbumId);
        }}
      />
    </>
  );
}

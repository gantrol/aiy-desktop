import { CreateAlbumDialog } from '@/renderer/components/albums/CreateAlbumDialog';
import { RenameAlbumDialog } from '@/renderer/components/creator/RenameAlbumDialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { OutlineNodeActions } from '@/renderer/features/creation-outline/useOutlineNodeActions';

export function OutlineActionDialogs({ actions }: { actions: OutlineNodeActions }) {
  const { messages } = useI18n();
  const albums = messages.gallery.albums;
  return (
    <>
      <CreateAlbumDialog
        open={actions.createParent !== undefined}
        parentTitle={actions.createParent?.title}
        labels={{
          title: albums.createTitle,
          childTitle: albums.createChild,
          name: albums.name,
          placeholder: albums.namePlaceholder,
          cancel: messages.common.cancel,
          create: albums.create,
          operationFailed: messages.creator.outline.actionFailed,
        }}
        onOpenChange={(open) => {
          if (!open) actions.setCreateParent(undefined);
        }}
        onCreate={actions.create}
      />
      <RenameAlbumDialog
        album={actions.renameAlbum}
        open={Boolean(actions.renameAlbum)}
        onOpenChange={(open) => {
          if (!open) actions.setRenameAlbum(null);
        }}
        onSave={actions.saveName}
      />
    </>
  );
}

import type { MaterialAlbumDto } from '@/shared/contracts';
import { beginMaterialAlbumDrag, endMaterialAlbumDrag } from '@/renderer/components/albums/albumDrag';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import { useI18n } from '@/renderer/i18n/useI18n';

export function MaterialAlbumDragHandle({ album, disabled }: { album: MaterialAlbumDto; disabled: boolean }) {
  const labels = useI18n().messages.gallery.albums;
  if (disabled || album.kind !== 'USER') return null;
  return (
    <TreeDragHandle
      label={`${labels.move}: ${album.title}`}
      className="absolute right-8 top-1/2 z-30 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      onDragStart={(event) => {
        event.stopPropagation();
        beginMaterialAlbumDrag(event.dataTransfer, album.id);
      }}
      onDragEnd={endMaterialAlbumDrag}
    />
  );
}

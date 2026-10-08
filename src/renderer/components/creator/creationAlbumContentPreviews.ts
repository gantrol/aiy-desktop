import type { LucideIcon } from 'lucide-react';
import { ALBUM_COVER_LAYERS } from '@/renderer/components/albums/albumCoverAssets';
import type { AlbumContentPreview } from '@/renderer/components/albums/AlbumContentCover';
import type {
  CreationFormProjection,
  CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';

/** Sample the current, ordered direct members without loading descendants or full documents. */
export function creationAlbumContentPreviews(
  items: readonly CreationItemProjection[],
  presentation: {
    forms(item: CreationItemProjection): readonly CreationFormProjection[];
    title(form: CreationFormProjection): string;
    icon(form: CreationFormProjection): LucideIcon;
    open(form: CreationFormProjection): void;
  },
): AlbumContentPreview[] {
  const previews: AlbumContentPreview[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const form of presentation.forms(item)) {
      const id = `${form.entityRef.kind}:${form.entityRef.id}`;
      if (!form.entity || seen.has(id)) continue;
      seen.add(id);
      previews.push({
        id,
        title: presentation.title(form),
        icon: presentation.icon(form),
        onOpen: () => presentation.open(form),
      });
      if (previews.length === ALBUM_COVER_LAYERS) return previews;
    }
  }
  return previews;
}

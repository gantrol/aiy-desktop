import { z } from 'zod';
import type { AlbumDto } from '@/shared/contracts';

export const contentAlbumOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
});
export type ContentAlbumOption = z.infer<typeof contentAlbumOptionSchema>;

/** Transfer only the hierarchy needed by note pickers, without album contents. */
export function contentAlbumOptions(albums: readonly AlbumDto[]): ContentAlbumOption[] {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const parents = new Map<string, string>();
  for (const album of albums) {
    for (const member of album.members) {
      if (member.targetType === 'ALBUM' && byId.has(member.targetId) && !parents.has(member.targetId))
        parents.set(member.targetId, album.id);
    }
  }
  return albums.flatMap((album) => {
    const visited = new Set<string>();
    let ancestor: AlbumDto | undefined = album;
    while (ancestor) {
      if (ancestor.archivedAt) return [];
      // Invalid cyclic membership cannot produce an unreachable picker branch.
      if (visited.has(ancestor.id)) return [{ id: album.id, title: album.title, parentId: null }];
      visited.add(ancestor.id);
      ancestor = byId.get(parents.get(ancestor.id) ?? '');
    }
    return [{ id: album.id, title: album.title, parentId: parents.get(album.id) ?? null }];
  });
}

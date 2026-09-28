import { z } from 'zod';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { contentAlbumOptions } from '@/shared/content-album-options';
import { petalError } from '@/shared/petal-errors';

export function executePetalNoteAlbum(
  command: string,
  input: unknown,
  context: ActiveLibraryContext,
  entry: PetalWindow | undefined,
  notes: PetalNoteService,
  locale: PetalLanguage['locale'],
  changed: (note: DesktopNote) => void,
) {
  if (command === 'note-albums') return contentAlbumOptions(context.database.listAlbums(locale));
  const request = z
    .object({ id: z.string().min(1).max(200), albumId: z.string().min(1).max(200).nullable() })
    .strict()
    .parse(input);
  if (entry?.instanceId && entry.instanceId !== request.id) throw petalError('sourceUnavailable');
  const note = notes.setAlbum(request.id, request.albumId);
  changed(note);
  return note;
}

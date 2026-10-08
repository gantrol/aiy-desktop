import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import { observePetalFlush } from '@/main/desktop-petals/petal-flush-observations';
import { contentImageImports } from '@/main/creations/content-image-imports';
import { contentImageImportIdSchema, contentImageStageSchema } from '@/shared/contracts/content-image-import';
import {
  desktopNoteAppearanceSchema,
  desktopNoteDraftSchema,
  desktopNoteSaveSchema,
} from '@/shared/contracts/desktop-petals';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';

/** Formal notes use the selected space's repositories; temporary notes never reach this handler. */
export function executePetalNoteCommand(
  deps: {
    notes: PetalNoteService;
    board: PetalBoardService;
    changed(id: string): void;
    publish(id: string): void;
  },
  command: string,
  input: unknown,
  context: ActiveLibraryContext,
  entry?: PetalWindow,
) {
  if (command === 'content-image-accepted')
    return contentImageImports(context.database).accepted(contentImageImportIdSchema.parse(input));
  if (command === 'content-image-stage')
    return contentImageImports(context.database).stage(contentImageStageSchema.parse(input));
  if (command === 'content-image-resolve')
    return contentImageImports(context.database).resolve(contentImageImportIdSchema.parse(input));
  const requireNote = (id: string) => {
    if (entry?.instanceId && entry.instanceId !== id) throw new Error('This window cannot edit another note');
  };
  if (command === 'checkpoint') {
    const request = desktopNoteDraftSchema.parse(input);
    requireNote(request.id);
    return deps.notes.checkpoint(request);
  }
  if (command === 'appearance') {
    const request = desktopNoteAppearanceSchema.parse(input);
    requireNote(request.id);
    if (isContentPinId(request.id)) throw petalError('invalidSettings');
    const note = deps.notes.appearance(request.id, request);
    deps.changed(note.id);
    return note;
  }
  const request = desktopNoteSaveSchema.parse(input);
  requireNote(request.id);
  const note = deps.notes.save(request);
  if (entry) observePetalFlush(entry, { status: note.persisted ? 'saved' : 'unchanged' });
  if (note.persisted) {
    deps.board.registerNote(note.id, true);
    deps.publish(note.id);
  }
  deps.changed(note.id);
  return note;
}

import { shell } from 'electron';
import type { LibraryDatabase } from '@/main/database';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import { storeNoteFile, resolveNoteFile } from '@/main/desktop-petals/note-file-store';
import {
  NOTE_FILE_LIMITS,
  noteFileCommandSchema,
  type NoteFile,
  type NoteFileCommand,
} from '@/shared/contracts/note-files';
import { isContentPinId } from '@/shared/contracts/petal-board';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { petalError } from '@/shared/petal-errors';

export async function executeNoteFiles(
  database: LibraryDatabase,
  notes: PetalNoteService | null,
  entry: PetalWindow | undefined,
  input: unknown,
  changed: (note: DesktopNote) => void,
) {
  const request = noteFileCommandSchema.parse(input);
  if (isContentPinId(request.id) || (entry && (entry.instanceId !== request.id || !notes)))
    throw petalError('sourceUnavailable');
  const source = entry
    ? notes!
    : {
        get: (id: string) => database.contentLibrary.note(id),
        files: (id: string, expectedHash: string, files: NoteFile[]) => {
          const { referenceAssets: _assets, ...content } = database.getInspirationStash(id).content;
          database.saveInspirationStash({
            mode: 'UPDATE',
            id,
            expectedContentHash: expectedHash,
            consumeCreationDraftId: null,
            content: { ...content, files },
          });
          return database.contentLibrary.note(id);
        },
      };
  const note = await executePetalFiles(database, source, request);
  if (entry && request.kind !== 'open' && note.persisted) changed(note);
  return note;
}

export async function executePetalFiles(
  database: LibraryDatabase,
  notes: Pick<PetalNoteService, 'get' | 'files'>,
  input: NoteFileCommand,
) {
  const note = notes.get(input.id);
  const files = note.files ?? [];
  if (input.kind === 'open') {
    const file = files.find((file) => file.id === input.fileId);
    if (!file) throw petalError('sourceUnavailable');
    const filePath = await resolveNoteFile(database.libraryRoot, file);
    if (/^\.(exe|com|cmd|bat|ps1|vbs|vbe|js|jse|wsf|wsh|msi|scr|lnk|url|reg|hta|sh|app|jar)$/i.test(file.extension))
      shell.showItemInFolder(filePath);
    else if (await shell.openPath(filePath)) throw petalError('sourceUnavailable');
    return note;
  }
  if (!note.editable || note.contentHash !== input.expectedHash) throw petalError('unsaved');
  if (input.kind === 'remove')
    return notes.files(
      input.id,
      input.expectedHash,
      files.filter((file) => file.id !== input.fileId),
    );
  if (files.length >= NOTE_FILE_LIMITS.count) throw petalError('fileLimit');
  const file = await storeNoteFile(database.libraryRoot, input.name, input.bytes);
  return notes.files(input.id, input.expectedHash, [...files, file]);
}

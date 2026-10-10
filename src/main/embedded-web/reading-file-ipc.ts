import { readFile } from 'node:fs/promises';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { storeNoteFile, resolveNoteFile } from '@/main/desktop-petals/note-file-store';
import { sha256HexAsync } from '@/main/database/core/storage';
import {
  readingFileImportSchema,
  readingFileReadSchema,
  readingFileByteLimit,
} from '@/shared/contracts/creation-reading';

export function registerReadingFileIpc(ipc: IpcHandlerRegistrar, getContext: () => ActiveLibraryContext | null) {
  let busy = false;
  const current = (spaceId: string) => {
    const context = getContext();
    if (!context || context.state !== 'ACTIVE' || context.database.getLocalSpace().id !== spaceId)
      throw new Error('READING_SPACE_CHANGED');
    return context;
  };
  ipc.handle('reading-file:import', async (_event, raw) => {
    const input = readingFileImportSchema.parse(raw);
    const context = current(input.spaceId);
    if (busy) throw new Error('READING_BUSY');
    busy = true;
    const release = context.acquireOperation();
    try {
      const file = await storeNoteFile(context.database.libraryRoot, input.name, input.bytes);
      if (current(input.spaceId) !== context) throw new Error('READING_SPACE_CHANGED');
      return file;
    } finally {
      busy = false;
      release();
    }
  });
  ipc.handle('reading-file:read', async (_event, raw) => {
    const input = readingFileReadSchema.parse(raw);
    const context = current(input.spaceId);
    if (busy) throw new Error('READING_BUSY');
    const article = context.database.getArticle(input.articleId);
    const source = article.content.reading?.sources.find((item) => item.id === input.sourceId);
    if (article.status !== 'ACTIVE' || source?.kind !== 'FILE' || source.file.byteSize > readingFileByteLimit)
      throw new Error('READING_FILE_UNAVAILABLE');
    if (!['.pdf', '.epub', '.txt', '.md'].includes(source.file.extension))
      throw new Error('READING_FORMAT_UNSUPPORTED');
    if (['.txt', '.md'].includes(source.file.extension) && source.file.byteSize > 1_000_000)
      throw new Error('READING_FILE_UNAVAILABLE');
    busy = true;
    const release = context.acquireOperation();
    try {
      const bytes = await readFile(await resolveNoteFile(context.database.libraryRoot, source.file));
      if (bytes.length !== source.file.byteSize || (await sha256HexAsync(bytes)) !== source.file.hash)
        throw new Error('READING_FILE_UNAVAILABLE');
      if (current(input.spaceId) !== context) throw new Error('READING_SPACE_CHANGED');
      return new Uint8Array(bytes);
    } finally {
      busy = false;
      release();
    }
  });
}

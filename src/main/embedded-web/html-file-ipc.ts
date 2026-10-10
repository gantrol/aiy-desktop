import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { htmlFileImportSchema, htmlFilePreviewSchema } from '@/shared/contracts/html-file';
import { embeddedWebHideSchema } from '@/shared/contracts/embedded-web';
import { htmlFilePreviews } from '@/main/embedded-web/html-file-previews';
import { storeHtmlFile, readHtmlFile } from '@/main/embedded-web/html-file-store';

export function registerHtmlFileIpc(ipc: IpcHandlerRegistrar, getContext: () => ActiveLibraryContext | null) {
  let importing = false;
  const current = (spaceId: string) => {
    const context = getContext();
    if (!context || context.state !== 'ACTIVE' || context.library.id !== spaceId)
      throw new Error('HTML_FILE_SPACE_CHANGED');
    return context;
  };
  ipc.handle('html-file:import', async (_event, raw) => {
    const input = htmlFileImportSchema.parse(raw);
    const context = current(input.spaceId);
    if (importing) throw new Error('HTML_IMPORT_BUSY');
    const release = context.acquireOperation();
    importing = true;
    try {
      const objectHash = await storeHtmlFile(context.database.libraryRoot, input.bytes);
      if (current(input.spaceId) !== context) throw new Error('HTML_FILE_SPACE_CHANGED');
      return { objectHash, fileName: input.fileName, spaceId: input.spaceId };
    } finally {
      importing = false;
      release();
    }
  });
  ipc.handle('html-file:preview', async (_event, raw) => {
    const input = htmlFilePreviewSchema.parse(raw);
    const context = current(input.spaceId);
    const release = context.acquireOperation();
    try {
      return await htmlFilePreviews(context).prepare(input);
    } finally {
      release();
    }
  });
  ipc.handle('html-file:read', async (_event, raw) => {
    const input = htmlFilePreviewSchema.parse(raw);
    const context = current(input.spaceId);
    const release = context.acquireOperation();
    try {
      const bytes = await readHtmlFile(context.database.libraryRoot, input.objectHash);
      if (current(input.spaceId) !== context) throw new Error('HTML_FILE_SPACE_CHANGED');
      return bytes.toString('utf8');
    } finally {
      release();
    }
  });
  ipc.handle('html-file:release', (_event, raw) => {
    const { previewId } = embeddedWebHideSchema.parse(raw);
    const context = getContext();
    if (context) htmlFilePreviews(context).release(previewId);
  });
}

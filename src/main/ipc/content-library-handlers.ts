import { shell } from 'electron';
import { linkPreviews, openLinkCard } from '@/main/links/link-preview-service';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { contentLibraryCommandSchema } from '@/shared/contracts/content-library';
import { copyLibraryReference } from '@/main/creations/content-reference-clipboard';
import { createAgentContentLink } from '@/main/agent/content-link';

export function registerContentLibraryIpc(ipc: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipc.handle('content-library:command', async (_event, raw) => {
    const command = contentLibraryCommandSchema.parse(raw);
    if (command.kind === 'agent-link') return createAgentContentLink(database, command.target);
    if (command.kind === 'reference-copy') return copyLibraryReference(database, command);
    if (command.kind === 'link-preview') return linkPreviews.get(command.url);
    if (command.kind === 'link-open') return openLinkCard(command.url);
    if (command.kind === 'reveal') {
      const directory = await database.ensureContentDirectory(command.source);
      const error = await shell.openPath(directory);
      if (error) throw new Error(error);
      return;
    }
    return database.executeContentLibrary(command);
  });
}

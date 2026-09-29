import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { meCommandSchema } from '@/shared/contracts/me';

export function registerMeIpc(ipc: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipc.handle('me:command', (_event, raw) => database.executeMe(meCommandSchema.parse(raw)));
}

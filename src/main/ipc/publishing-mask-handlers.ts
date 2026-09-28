import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { publishingMaskSaveInputSchema, publishingMaskScopeSchema } from '@/shared/contracts/publishing-mask';

export function registerPublishingMaskIpc(ipc: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipc.handle('publishing-masks:get', (_event, raw) =>
    database.publishingMasks.get(publishingMaskScopeSchema.parse(raw)),
  );
  ipc.handle('publishing-masks:read', (_event, raw) =>
    database.publishingMasks.read(publishingMaskScopeSchema.parse(raw)),
  );
  ipc.handle('publishing-masks:save', (_event, raw) =>
    database.publishingMasks.save(publishingMaskSaveInputSchema.parse(raw)),
  );
}

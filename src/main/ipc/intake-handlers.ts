import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { intakeSchema } from '@/main/ipc/schemas';

export function registerIntakeIpc(ipcMain: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipcMain.handle('intake:commit', async (_event, raw) => {
    const input = intakeSchema.parse(raw);
    const result = await database.commitIntake(input);
    // Importing from inside an album files the material there; a failed album
    // write must not discard the import that already succeeded.
    if (!input.albumId || !result.materialIds.length) return result;
    try {
      database.addMaterialsToDestinations({
        targets: result.materialIds.map((materialId) => ({ kind: 'MATERIAL' as const, materialId })),
        albumIds: [input.albumId],
        termIds: [],
      });
      return { ...result, albumId: input.albumId };
    } catch {
      return result;
    }
  });
}

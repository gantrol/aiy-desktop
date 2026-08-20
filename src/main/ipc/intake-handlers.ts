import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { intakeSchema } from '@/main/ipc/schemas';
import { sha256HexAsync } from '@/main/database/core/storage';
import { rasterizeSvgBytesInSandbox } from '@/main/media/svg-rasterization';
import { storeSvgRasterCache } from '@/main/media/svg-raster-cache';
import type { IntakeCommitInput } from '@/shared/contracts';

export function registerIntakeIpc(ipcMain: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipcMain.handle('intake:commit', async (_event, raw) => {
    const parsed = intakeSchema.parse(raw);
    const items: IntakeCommitInput['items'] = [];
    let totalBytes = 0;
    let totalSvgRasterBytes = 0;
    for (const item of parsed.items) {
      if (item.kind === 'TEXT') {
        items.push(item);
        continue;
      }
      if (item.kind === 'IMAGE' && item.mimeType === 'image/svg+xml') {
        const rasterized = await rasterizeSvgBytesInSandbox(item.bytes);
        totalSvgRasterBytes += rasterized.bytes.byteLength;
        if (totalSvgRasterBytes > 100 * 1024 * 1024) {
          throw new Error('SVG raster derivatives must be 100 MB or smaller');
        }
        const sourceHash = await sha256HexAsync(item.bytes);
        await storeSvgRasterCache(database.libraryRoot, sourceHash, rasterized.bytes);
        totalBytes += item.bytes.byteLength;
        items.push({
          ...item,
          width: rasterized.width,
          height: rasterized.height,
        });
      } else {
        totalBytes += item.bytes.byteLength;
        items.push(item);
      }
    }
    if (totalBytes > 100 * 1024 * 1024) throw new Error('Import must be 100 MB or smaller');
    const input: IntakeCommitInput = { ...parsed, items };
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

import type { LibraryDatabase } from '@/main/database';
import { petalError } from '@/shared/petal-errors';

/** The released IMAGE source key also covers video/audio. The restricted renderer never receives file paths. */
export async function openPetalImageSource(
  database: Pick<LibraryDatabase, 'resolveAssetFilesAsync' | 'resolveAssetRevealPathAsync' | 'listAssetRevealTargets'>,
  assetId: string,
  openPath: (path: string) => Promise<string>,
) {
  const source = (await database.resolveAssetFilesAsync([assetId])).get(assetId);
  if (!source || !/^(image|video|audio)\//.test(source.mimeType)) throw petalError('sourceUnavailable');
  try {
    const targets = await database.listAssetRevealTargets(assetId);
    const readable = await database.resolveAssetRevealPathAsync(assetId, targets[0]?.context);
    if (!readable || (await openPath(readable))) throw petalError('sourceUnavailable');
  } catch {
    throw petalError('sourceUnavailable');
  }
}

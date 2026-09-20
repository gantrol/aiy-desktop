import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import type { ContentPackApplyCommand, ContentPackPreviewCommand } from '@/shared/contracts/content-pack-command';
import type { PackApplyImportResult } from '@/shared/contracts';

function destinationPath(database: LibraryDatabase, input: ContentPackPreviewCommand) {
  if (database.getLocalSpace().id !== input.spaceId) throw new Error('SPACE_CONFLICT');
  if (!path.isAbsolute(input.path) || /^[\\/]{2}/u.test(input.path) || /[\0*?]/u.test(input.path))
    throw new Error('CONTENT_PACK_INVALID_PATH');
  return path.normalize(input.path);
}

export function previewContentPackCommand(database: LibraryDatabase, input: ContentPackPreviewCommand) {
  return database.previewContentPack(destinationPath(database, input));
}

export async function applyContentPackCommand(
  database: LibraryDatabase,
  input: ContentPackApplyCommand,
  signal?: AbortSignal,
): Promise<PackApplyImportResult> {
  signal?.throwIfAborted();
  const packId = await database.importPreviewedContentPack(
    destinationPath(database, input),
    input.expectedContentHash,
    input.expectedPackageFingerprint,
    signal,
  );
  const installation = database.listPackInstallations().find((item) => item.packId === packId);
  if (!installation?.selectedReleaseId) throw new Error('Content pack update did not select a release');
  const release = database.getPackRelease(installation.selectedReleaseId);
  return { packId, releaseId: release.id, version: release.version };
}

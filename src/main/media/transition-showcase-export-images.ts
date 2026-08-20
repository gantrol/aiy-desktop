import { lstat } from 'node:fs/promises';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import { MAX_IMAGE_DECODER_INPUT_BYTES } from '@/shared/image-decoder-protocol';
import {
  TRANSITION_SHOWCASE_EXPORT_IMAGE_SIZE,
  TRANSITION_SHOWCASE_EXPORT_TOTAL_MAX_BYTES,
  transitionShowcaseExportImageSnapshotSchema,
  transitionShowcaseExportImageSnapshotsSchema,
  type TransitionShowcaseExportImageSnapshot,
} from '@/shared/contracts/transition-showcase';

const MAX_TOTAL_SOURCE_BYTES = MAX_IMAGE_DECODER_INPUT_BYTES * 2;

function bufferView(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function assertBoundedSources(sources: readonly ResolvedAssetFile[]) {
  let totalBytes = 0;
  for (const source of sources) {
    if (!source.mimeType.startsWith('image/')) throw new Error('Transition export only supports image assets');
    const metadata = await lstat(source.absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
      throw new Error('Transition export image is unavailable');
    }
    totalBytes += metadata.size;
    if (totalBytes > MAX_TOTAL_SOURCE_BYTES) throw new Error('Transition export source images exceed the read limit');
  }
}

async function createSnapshot(source: ResolvedAssetFile): Promise<TransitionShowcaseExportImageSnapshot> {
  return withDecodedImageFileInSandbox(
    source.absolutePath,
    { operation: 'thumbnail', size: TRANSITION_SHOWCASE_EXPORT_IMAGE_SIZE },
    async (result) => {
      if (result.operation !== 'thumbnail') throw new Error('Transition export decoder returned the wrong operation');
      const pngBytes = bufferView(result.pngBytes);
      const structure = await validateCanvasPngAsync(pngBytes);
      if (!structure || structure.width !== result.width || structure.height !== result.height) {
        throw new Error('Transition export decoder returned an invalid PNG');
      }
      return transitionShowcaseExportImageSnapshotSchema.parse({
        assetId: source.assetId,
        pngBytes: Uint8Array.from(result.pngBytes),
        width: result.width,
        height: result.height,
      });
    },
  );
}

export async function createTransitionShowcaseExportImages(sources: readonly ResolvedAssetFile[]) {
  await assertBoundedSources(sources);
  const snapshots: TransitionShowcaseExportImageSnapshot[] = [];
  let totalOutputBytes = 0;
  for (const source of sources) {
    const snapshot = await createSnapshot(source);
    totalOutputBytes += snapshot.pngBytes.byteLength;
    if (totalOutputBytes > TRANSITION_SHOWCASE_EXPORT_TOTAL_MAX_BYTES) {
      throw new Error('Transition export images exceed the transfer limit');
    }
    snapshots.push(snapshot);
  }
  return transitionShowcaseExportImageSnapshotsSchema.parse(snapshots);
}

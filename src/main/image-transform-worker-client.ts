import type { LibraryDatabase } from '@/main/database';
import { validateCanvasPngAsync } from '@/main/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/sandboxed-image-decoder';
import type { ImageCropInput, ImageTransformOutputDto } from '@/shared/contracts';

function bufferView(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function cropImageInSandbox(
  database: LibraryDatabase,
  input: ImageCropInput,
): Promise<ImageTransformOutputDto> {
  const source = database.resolveImageCropSource(input.seriesId, input.sourceAssetId);
  if (!source) throw new Error('The crop source does not belong to this creation');

  return withDecodedImageFileInSandbox(
    source.path,
    {
      operation: 'crop',
      ratioWidth: input.ratioWidth,
      ratioHeight: input.ratioHeight,
    },
    async (result) => {
      if (result.operation !== 'crop') throw new Error('Image decoder returned the wrong operation');
      if (!(
        (result.sourceWidth === source.width && result.sourceHeight === source.height) ||
        (result.sourceWidth === source.height && result.sourceHeight === source.width)
      )) {
        throw new Error('Image decoder dimensions do not match the stored crop source');
      }
      const outputBytes = bufferView(result.pngBytes);
      const structure = await validateCanvasPngAsync(outputBytes);
      if (
        !structure ||
        structure.width !== result.cropWidth ||
        structure.height !== result.cropHeight ||
        result.width !== result.cropWidth ||
        result.height !== result.cropHeight
      ) {
        throw new Error('Image transform output does not match its reported PNG geometry');
      }
      const stored = await database.storeImageTransformBuffer(outputBytes);
      if (
        stored.width !== result.cropWidth ||
        stored.height !== result.cropHeight ||
        stored.byteSize !== outputBytes.byteLength
      ) {
        throw new Error('Stored image transform does not match its validated output');
      }
      return database.commitStoredImageCrop({
        ...input,
        ratioWidth: result.ratioWidth,
        ratioHeight: result.ratioHeight,
        stored,
        cropX: result.cropX,
        cropY: result.cropY,
        cropWidth: result.cropWidth,
        cropHeight: result.cropHeight,
      });
    },
  );
}

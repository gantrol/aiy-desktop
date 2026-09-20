import { withDecodedImageBytesInSandbox } from '@/main/media/sandboxed-image-decoder';
import { MAX_IMAGE_DECODER_PIXELS } from '@/shared/image-decoder-protocol';
import {
  inspectUploadImage,
  orientedUploadImageDimensions,
  uploadImageDimensions,
  type UploadImageMimeType,
} from '@/shared/upload-image-policy';

export interface PreparedUploadImage {
  bytes: Buffer;
  mimeType: UploadImageMimeType;
  width: number;
  height: number;
  changed: boolean;
}

export async function prepareUploadImage(
  bytes: Buffer,
  mimeType: string,
  options: { mode: 'BALANCED' | 'ORIGINAL'; signal?: AbortSignal },
): Promise<PreparedUploadImage> {
  options.signal?.throwIfAborted();
  if (options.mode !== 'BALANCED' && options.mode !== 'ORIGINAL') throw new Error('UPLOAD_IMAGE_MODE_INVALID');
  const source = inspectUploadImage(bytes, mimeType);
  const dimensions = orientedUploadImageDimensions(source);
  const original = { bytes, mimeType: source.mimeType, ...dimensions, changed: false };
  if (options.mode === 'ORIGINAL' || source.animated || source.mimeType === 'image/gif') return original;
  if (source.width * source.height > MAX_IMAGE_DECODER_PIXELS) {
    throw new Error('UPLOAD_IMAGE_DECODER_PIXELS_EXCEEDED');
  }
  return withDecodedImageBytesInSandbox(
    bytes,
    source.mimeType,
    { operation: 'compress' },
    (response) => {
      options.signal?.throwIfAborted();
      if (response.operation !== 'compress' || response.outputMimeType !== source.mimeType) {
        throw new Error('UPLOAD_IMAGE_ENCODING_FAILED');
      }
      const output = inspectUploadImage(response.outputBytes, response.outputMimeType);
      const expected = uploadImageDimensions(dimensions.width, dimensions.height);
      if (
        output.animated ||
        output.orientation !== 1 ||
        response.sourceWidth !== dimensions.width ||
        response.sourceHeight !== dimensions.height ||
        response.width !== expected.width ||
        response.height !== expected.height ||
        output.width !== expected.width ||
        output.height !== expected.height
      ) {
        throw new Error('UPLOAD_IMAGE_ENCODING_FAILED');
      }
      if (response.outputBytes.byteLength >= bytes.byteLength) {
        return original;
      }
      const outputBytes = Buffer.from(response.outputBytes);
      options.signal?.throwIfAborted();
      return { bytes: outputBytes, mimeType: output.mimeType, ...expected, changed: true };
    },
    120_000,
    options.signal,
  );
}

import { clipboard, nativeImage } from 'electron';
import { validateCanvasPngAsync } from '@/main/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/sandboxed-image-decoder';

function bufferView(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function copyImageInSandbox(sourcePath: string): Promise<void> {
  await withDecodedImageFileInSandbox(sourcePath, { operation: 'normalize' }, async (result) => {
    if (result.operation !== 'normalize') throw new Error('Image decoder returned the wrong operation');
    const pngBytes = bufferView(result.pngBytes);
    const structure = await validateCanvasPngAsync(pngBytes);
    if (!structure || structure.width !== result.width || structure.height !== result.height) {
      throw new Error('Image decoder returned an invalid PNG');
    }
    const image = nativeImage.createFromBuffer(pngBytes);
    const dimensions = image.getSize();
    if (image.isEmpty() || dimensions.width !== result.width || dimensions.height !== result.height) {
      throw new Error('Unable to decode normalized image');
    }
    clipboard.writeImage(image);
  });
}

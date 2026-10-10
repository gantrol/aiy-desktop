import type { ImageEditDocument } from '@/shared/contracts/image-edit';
import { rasterImageEdit } from '@/renderer/features/image-editing/image-edit-raster';

export async function loadEditImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  signal.throwIfAborted();
  const abort = () => {
    image.src = '';
  };
  signal.addEventListener('abort', abort, { once: true });
  image.src = url;
  try {
    await image.decode();
    signal.throwIfAborted();
    return image;
  } catch (error) {
    image.src = '';
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Only pixels enter the clipboard/file pipeline. Selection and recovery metadata never do. */
export async function exportImageEdit(image: HTMLImageElement, document: ImageEditDocument): Promise<Uint8Array> {
  const blob = await rasterImageEdit(image, document, false);
  return new Uint8Array(await blob.arrayBuffer());
}

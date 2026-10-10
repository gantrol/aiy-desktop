import type { ImageEditDocument } from '@/shared/contracts/image-edit';

/** A single bounded job; abort terminates decoding/rendering before another preview starts. */
export async function rasterImageEdit(
  image: HTMLImageElement,
  document: ImageEditDocument,
  preview: boolean,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(image);
  if (signal?.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL('./image-edit-raster.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    bitmap.close();
    throw error;
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, blob?: Blob) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (blob) resolve(blob);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('IMAGE_EDIT_TIMEOUT')), 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('IMAGE_EDIT_RENDER'));
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (event.data.blob instanceof Blob) finish(undefined, event.data.blob);
      else finish(new Error('IMAGE_EDIT_RENDER'));
    };
    try {
      worker.postMessage({ image: bitmap, document, preview }, [bitmap]);
    } catch (error) {
      bitmap.close();
      finish(error);
    }
  });
}

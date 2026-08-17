const previewEdge = 160;

async function videoPreview(file: File): Promise<IntakePreview> {
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Video preview timed out')), 15_000);
      const finish = (callback: () => void) => {
        window.clearTimeout(timeout);
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('error', failed);
        callback();
      };
      const loaded = () => finish(resolve);
      const failed = () => finish(() => reject(new Error('Video format or codec is unavailable')));
      video.addEventListener('loadeddata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.src = sourceUrl;
      video.load();
    });

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Video dimensions are unavailable');
    const scale = Math.min(1, previewEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Preview canvas unavailable');
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    const durationMs = Math.round(video.duration * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('Video duration is unavailable');
    return { url: URL.createObjectURL(blob), width: sourceWidth, height: sourceHeight, durationMs };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Import batches routinely hold multi-megapixel files. Handing the raw blob to
 * a 64px thumbnail makes the renderer decode every source image at full size,
 * which is what makes a drop of several photos stutter. Decode once at preview
 * scale instead, and fall back to the raw blob when the browser cannot.
 */
export interface IntakePreview {
  url: string;
  width: number;
  height: number;
  durationMs?: number;
}

export async function intakePreview(file: File, video = false): Promise<IntakePreview> {
  if (video) return videoPreview(file);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const scale = Math.min(1, previewEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Preview canvas unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    return { url: URL.createObjectURL(blob), width: sourceWidth, height: sourceHeight };
  } catch {
    return { url: URL.createObjectURL(file), width: 0, height: 0 };
  } finally {
    bitmap?.close();
  }
}

export async function intakePreviewUrl(file: File): Promise<string> {
  return (await intakePreview(file)).url;
}

export function releaseIntakePreview(previewUrl: string) {
  URL.revokeObjectURL(previewUrl);
}

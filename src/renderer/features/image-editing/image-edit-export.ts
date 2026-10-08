import type { ImageEditDocument } from '@/shared/contracts/image-edit';
import { arrowPath, imageViewport, markBounds, penPath } from '@/renderer/features/image-editing/image-edit-geometry';

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
  const { width, height, matrix } = imageViewport(document);
  const canvas = documentCanvas(width, height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('IMAGE_EDIT_CANVAS');
    context.setTransform(...matrix);
    context.drawImage(image, 0, 0, document.width, document.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const mark of document.marks) {
      context.save();
      context.strokeStyle = mark.color;
      context.fillStyle = mark.color;
      context.lineWidth = mark.stroke;
      const box = markBounds(mark);
      if (mark.kind === 'arrow' || mark.kind === 'pen')
        context.stroke(new Path2D(mark.kind === 'arrow' ? arrowPath(mark) : penPath(mark)));
      else if (mark.kind === 'rectangle') context.strokeRect(box.x, box.y, box.width, box.height);
      else if (mark.kind === 'cover' || mark.kind === 'highlight') {
        context.globalAlpha = mark.kind === 'highlight' ? 0.35 : 1;
        context.fillRect(box.x, box.y, box.width, box.height);
      } else {
        context.font = `${mark.fontSize}px sans-serif`;
        context.textBaseline = 'alphabetic';
        mark.text
          .split('\n')
          .forEach((line, index) =>
            context.fillText(line, mark.x, mark.y + mark.fontSize + index * mark.fontSize * 1.25),
          );
      }
      context.restore();
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('IMAGE_EDIT_ENCODE'))), 'image/png'),
    );
    if (blob.size > 25 * 1024 * 1024) throw new Error('IMAGE_EDIT_LIMIT');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function documentCanvas(width: number, height: number) {
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

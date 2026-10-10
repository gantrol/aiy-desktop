import { imageTextLines } from '@/shared/image-edit-text';
import { imageEditDocumentSchema, type ImageEditDocument, type ImageEditMark } from '@/shared/contracts/image-edit';
import {
  arrowPath,
  linePath,
  penPath,
  markBounds,
  imageViewport,
} from '@/renderer/features/image-editing/image-edit-geometry';

function paintEffect(
  canvas: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D,
  mark: ImageEditMark,
  scale: number,
) {
  const box = markBounds(mark);
  const x = Math.max(0, Math.floor(box.x * scale)),
    y = Math.max(0, Math.floor(box.y * scale));
  const width = Math.min(canvas.width, Math.ceil((box.x + box.width) * scale)) - x;
  const height = Math.min(canvas.height, Math.ceil((box.y + box.height) * scale)) - y;
  if (width <= 0 || height <= 0) return;
  const block = Math.max(2, mark.stroke * 2 * scale);
  const padding = mark.kind === 'blur' ? Math.ceil(block * 3) : 0;
  const sx = Math.max(0, x - padding),
    sy = Math.max(0, y - padding);
  const sw = Math.min(canvas.width, x + width + padding) - sx,
    sh = Math.min(canvas.height, y + height + padding) - sy;
  const sample = new OffscreenCanvas(
    mark.kind === 'mosaic' ? Math.max(1, Math.ceil(width / block)) : sw,
    mark.kind === 'mosaic' ? Math.max(1, Math.ceil(height / block)) : sh,
  );
  try {
    const source = sample.getContext('2d');
    if (!source) throw new Error('IMAGE_EDIT_CANVAS');
    source.drawImage(canvas, sx, sy, sw, sh, 0, 0, sample.width, sample.height);
    context.save();
    context.resetTransform();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    if (mark.kind === 'mosaic') {
      context.imageSmoothingEnabled = false;
      context.clearRect(x, y, width, height);
      context.drawImage(sample, x, y, width, height);
    } else {
      context.clearRect(x, y, width, height);
      context.filter = `blur(${block}px)`;
      context.drawImage(sample, sx, sy, sw, sh);
    }
    context.restore();
  } finally {
    sample.width = sample.height = 1;
  }
}

async function rasterize(image: ImageBitmap, document: ImageEditDocument, preview: boolean) {
  const scale = preview ? Math.min(1, 2048 / Math.max(document.width, document.height)) : 1;
  const surface = new OffscreenCanvas(
    Math.max(1, Math.round(document.width * scale)),
    Math.max(1, Math.round(document.height * scale)),
  );
  let result: OffscreenCanvas | undefined;
  try {
    const context = surface.getContext('2d');
    if (!context) throw new Error('IMAGE_EDIT_CANVAS');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, document.width, document.height);
    image.close();
    for (const mark of document.marks) {
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = context.fillStyle = mark.color;
      context.lineWidth = mark.stroke;
      const box = markBounds(mark);
      if (mark.kind === 'mosaic' || mark.kind === 'blur') paintEffect(surface, context, mark, scale);
      else if (mark.kind === 'arrow' || mark.kind === 'line' || mark.kind === 'pen')
        context.stroke(
          new Path2D(mark.kind === 'arrow' ? arrowPath(mark) : mark.kind === 'line' ? linePath(mark) : penPath(mark)),
        );
      else if (mark.kind === 'rectangle') context.strokeRect(box.x, box.y, box.width, box.height);
      else if (mark.kind === 'ellipse') {
        context.beginPath();
        context.ellipse(
          box.x + box.width / 2,
          box.y + box.height / 2,
          box.width / 2,
          box.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
      } else if (mark.kind === 'cover' || mark.kind === 'highlight') {
        context.globalAlpha = mark.kind === 'highlight' ? 0.35 : 1;
        context.fillRect(box.x, box.y, box.width, box.height);
      } else {
        context.font = `${mark.fontSize}px ${mark.fontFamily ?? 'sans-serif'}`;
        context.textBaseline = 'alphabetic';
        imageTextLines(mark, (text) => context.measureText(text).width).forEach((line, index) =>
          context.fillText(line, mark.x, mark.y + mark.fontSize + index * mark.fontSize * 1.25),
        );
      }
      context.restore();
    }
    // Preview remains in source coordinates, sharing the editor's crop/rotation transform.
    if (preview) return await surface.convertToBlob({ type: 'image/png' });
    const viewport = imageViewport(document);
    const width = document.output?.width ?? viewport.width,
      height = document.output?.height ?? viewport.height;
    result = new OffscreenCanvas(width, height);
    const output = result.getContext('2d');
    if (!output) throw new Error('IMAGE_EDIT_CANVAS');
    output.scale(width / viewport.width, height / viewport.height);
    output.transform(...viewport.matrix);
    output.drawImage(surface, 0, 0, document.width, document.height);
    return await result.convertToBlob({ type: 'image/png' });
  } finally {
    image.close();
    surface.width = surface.height = 1;
    if (result) result.width = result.height = 1;
  }
}

self.onmessage = async (event: MessageEvent<{ image: ImageBitmap; document: ImageEditDocument; preview: boolean }>) => {
  try {
    const document = imageEditDocumentSchema.parse(event.data.document);
    if (event.data.image.width !== document.width || event.data.image.height !== document.height)
      throw new Error('IMAGE_EDIT_DIMENSIONS');
    const blob = await rasterize(event.data.image, document, event.data.preview);
    if (!event.data.preview && blob.size > 25 * 1024 * 1024) throw new Error('IMAGE_EDIT_LIMIT');
    self.postMessage({ blob });
  } catch {
    event.data.image?.close();
    self.postMessage({ error: 'IMAGE_EDIT_RENDER' });
  }
};

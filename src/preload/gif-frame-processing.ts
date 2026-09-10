import { ipcRenderer } from 'electron';
import { auditGifStates, sampleGifState } from '@/shared/gif-frame-audit';
import {
  GIF_FRAME_REQUEST,
  GIF_FRAME_RESPONSE,
  gifFrameRequestSchema,
  type GifFrameRequest,
} from '@/shared/gif-frame-protocol';
import { GIF_MAX_SOURCE_BYTES, GIF_MAX_SOURCE_PIXELS, gifErrorCode } from '@/shared/contracts/gif-making';
import { gifMotionCrop, gifRegionPixels, gifSheetLayout, type GifPixelRect } from '@/shared/gif-motion';

function surface(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('GIF_FAILED');
  return { canvas, context };
}
async function png(canvas: OffscreenCanvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > GIF_MAX_SOURCE_BYTES) throw new Error('GIF_LIMIT');
  return new Uint8Array(await blob.arrayBuffer());
}
async function bitmap(bytes: Uint8Array) {
  const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
  if (image.width * image.height > GIF_MAX_SOURCE_PIXELS) {
    image.close();
    throw new Error('GIF_LIMIT');
  }
  return image;
}
function cropImage(context: OffscreenCanvasRenderingContext2D, image: ImageBitmap, rect: GifPixelRect) {
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, context.canvas.width, context.canvas.height);
}
function alignment(
  base: Uint8ClampedArray,
  candidate: Uint8ClampedArray,
  width: number,
  height: number,
  region: GifPixelRect,
) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 100));
  let best = { x: 0, y: 0, score: Infinity };
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      let error = 0,
        count = 0;
      for (let y = 5; y < height - 5; y += step)
        for (let x = 5; x < width - 5; x += step) {
          if (
            x >= region.x - 2 &&
            x < region.x + region.width + 2 &&
            y >= region.y - 2 &&
            y < region.y + region.height + 2
          )
            continue;
          const p = (y * width + x) * 4,
            q = ((y + dy) * width + x + dx) * 4;
          if (base[p + 3] < 250) continue;
          for (let c = 0; c < 3; c++) error += Math.min(45, Math.abs(base[p + c] - candidate[q + c]));
          count += 3;
        }
      if (count && error / count < best.score) best = { x: dx, y: dy, score: error / count };
    }
  if (best.score > 30) throw new Error('GIF_ALIGNMENT_FAILED');
  return best;
}
function compositeRegion(
  original: ImageData,
  frame: ImageData,
  pixels: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  crop: GifPixelRect,
  box: GifPixelRect,
  softness: number,
) {
  let moved = 0;
  const local = { ...box, x: box.x - crop.x, y: box.y - crop.y };
  const shift = alignment(reference, pixels, crop.width, crop.height, local);
  const feather = Math.min(box.width, box.height) * softness;
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      const px = x - crop.x + shift.x,
        py = y - crop.y + shift.y;
      if (px < 0 || py < 0 || px >= crop.width || py >= crop.height) continue;
      const distance = Math.min(
        x - box.x + 0.5,
        box.x + box.width - x - 0.5,
        y - box.y + 0.5,
        box.y + box.height - y - 0.5,
      );
      const t = feather ? Math.min(1, distance / feather) : 1,
        alpha = t * t * (3 - 2 * t);
      const p = (y * original.width + x) * 4,
        q = (py * crop.width + px) * 4;
      for (let c = 0; c < 3; c++)
        frame.data[p + c] = Math.round(original.data[p + c] * (1 - alpha) + pixels[q + c] * alpha);
      if ([0, 1, 2].some((c) => Math.abs(frame.data[p + c] - original.data[p + c]) > 3)) moved++;
    }
  return moved;
}
async function process(request: GifFrameRequest) {
  const source = await bitmap(request.source);
  let sheet: ImageBitmap | null = null;
  try {
    if (source.width > 2048 || source.height > 2048) throw new Error('GIF_LIMIT');
    const settings = request.settings;
    const region = settings.mode === 'REGION' ? settings.region : null;
    const crop = gifMotionCrop(source.width, source.height, region);
    if (request.operation === 'PREPARE') {
      const scale = Math.min(4, 1024 / Math.max(crop.width, crop.height));
      const reference = surface(Math.round(crop.width * scale), Math.round(crop.height * scale));
      cropImage(reference.context, source, crop);
      const outputs = [await png(reference.canvas)];
      if (region) {
        const guide = surface(reference.canvas.width, reference.canvas.height);
        guide.context.fillStyle = '#252525';
        guide.context.fillRect(0, 0, guide.canvas.width, guide.canvas.height);
        const box = gifRegionPixels(region, source.width, source.height);
        guide.context.fillStyle = '#ff00ff';
        guide.context.fillRect(
          (box.x - crop.x) * scale,
          (box.y - crop.y) * scale,
          box.width * scale,
          box.height * scale,
        );
        outputs.push(await png(guide.canvas));
      }
      return { images: outputs };
    }
    const individual = settings.generationMode === 'FRAMES';
    if (!individual && !request.sheet) throw new Error('GIF_SHEET_INVALID');
    if (!individual) sheet = await bitmap(request.sheet!);
    const layout = individual ? { columns: 1, rows: 1 } : gifSheetLayout(settings.keyframes, crop.width / crop.height);
    const expectedAspect = ((crop.width / crop.height) * layout.columns) / layout.rows;
    if (sheet && Math.abs(sheet.width / sheet.height / expectedAspect - 1) > 0.08) throw new Error('GIF_SHEET_INVALID');
    const whole = surface(source.width, source.height),
      patch = surface(crop.width, crop.height);
    whole.context.drawImage(source, 0, 0);
    const original = whole.context.getImageData(0, 0, source.width, source.height);
    cropImage(patch.context, source, crop);
    const reference = patch.context.getImageData(0, 0, crop.width, crop.height).data;
    const box = region ? gifRegionPixels(region, source.width, source.height) : null;
    const outputs: Uint8Array[] = [];
    const auditBox = box ?? { x: 0, y: 0, width: source.width, height: source.height };
    const samples = [sampleGifState(original.data, source.width, auditBox)];
    let total = 0,
      moved = 0;
    // Panel zero is the shared source pose; use the actual source for exact loop endpoints.
    for (let i = 1; i < settings.keyframes; i++) {
      if (individual) {
        sheet?.close();
        sheet = null;
        const input = request.frameImages?.[i - 1];
        if (!input) throw new Error('GIF_GENERATION_INVALID_OUTPUT');
        sheet = await bitmap(input);
        if (Math.abs(sheet.width / sheet.height / expectedAspect - 1) > 0.08)
          throw new Error('GIF_GENERATION_INVALID_OUTPUT');
      }
      if (!sheet) throw new Error('GIF_SHEET_INVALID');
      const panel = individual ? 0 : i;
      const x0 = Math.round(((panel % layout.columns) * sheet.width) / layout.columns);
      const x1 = Math.round((((panel % layout.columns) + 1) * sheet.width) / layout.columns);
      const y0 = Math.round((Math.floor(panel / layout.columns) * sheet.height) / layout.rows);
      const y1 = Math.round(((Math.floor(panel / layout.columns) + 1) * sheet.height) / layout.rows);
      patch.context.clearRect(0, 0, crop.width, crop.height);
      cropImage(patch.context, sheet, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      const pixels = patch.context.getImageData(0, 0, crop.width, crop.height).data;
      const frame = new ImageData(new Uint8ClampedArray(original.data), source.width, source.height);
      if (box) {
        moved += compositeRegion(original, frame, pixels, reference, crop, box, settings.feather);
      } else {
        frame.data.set(pixels);
        if (pixels.some((v, p) => Math.abs(v - original.data[p]) > 3)) moved++;
      }
      whole.context.putImageData(frame, 0, 0);
      samples.push(sampleGifState(frame.data, source.width, auditBox));
      const encoded = await png(whole.canvas);
      total += encoded.byteLength;
      if (total > GIF_MAX_SOURCE_BYTES) throw new Error('GIF_LIMIT');
      outputs.push(encoded);
    }
    if (!moved) throw new Error('GIF_NO_MOTION');
    return { images: outputs, audit: auditGifStates(samples, Boolean(box)) };
  } finally {
    source.close();
    sheet?.close();
  }
}
let busy = false;
ipcRenderer.on(GIF_FRAME_REQUEST, (_event, raw: unknown) => {
  const parsed = gifFrameRequestSchema.safeParse(raw);
  if (!parsed.success || busy) return;
  busy = true;
  void process(parsed.data).then(
    (result) => ipcRenderer.send(GIF_FRAME_RESPONSE, { kind: 'complete', runId: parsed.data.runId, ...result }),
    (error) =>
      ipcRenderer.send(GIF_FRAME_RESPONSE, { kind: 'error', runId: parsed.data.runId, error: gifErrorCode(error) }),
  );
});

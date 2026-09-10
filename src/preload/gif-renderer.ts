import { ipcRenderer } from 'electron';
import '@/preload/gif-frame-processing';
import {
  GIF_RENDER_REQUEST,
  GIF_RENDER_RESPONSE,
  gifRenderRequestSchema,
  type GifRenderRequest,
} from '@/shared/gif-render-protocol';
import { GIF_MAX_SOURCE_PIXELS, gifErrorCode, type GifFrame } from '@/shared/contracts/gif-making';
import { gifImagePlacement } from '@/shared/gif-layout';
import { encodeGif } from '@/shared/gif-encoder';

async function render(request: GifRenderRequest) {
  const { manifest } = request;
  const sources = new Map(request.sources.map((source) => [source.assetId, source]));
  const bitmap = async (id: string) => {
    const source = sources.get(id);
    if (!source) throw new Error('GIF_ASSET_UNAVAILABLE');
    const image = await createImageBitmap(new Blob([Uint8Array.from(source.bytes)], { type: source.mimeType }));
    if (image.width * image.height > GIF_MAX_SOURCE_PIXELS) {
      image.close();
      throw new Error('GIF_LIMIT');
    }
    return image;
  };
  const canvas = new OffscreenCanvas(manifest.width, manifest.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('GIF_FAILED');
  const background = manifest.backgroundAssetId ? await bitmap(manifest.backgroundAssetId) : null;
  const draw = (image: ImageBitmap, frame: GifFrame | null, backgroundLayer = false) => {
    const placement = gifImagePlacement(manifest, image, frame, backgroundLayer);
    const { crop } = placement;
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
  };
  try {
    return await encodeGif(
      manifest,
      async (frame) => {
        context.clearRect(0, 0, manifest.width, manifest.height);
        if (manifest.backgroundColor) {
          context.fillStyle = manifest.backgroundColor;
          context.fillRect(0, 0, manifest.width, manifest.height);
        }
        if (background) draw(background, null, true);
        const image = await bitmap(frame.assetId);
        try {
          draw(image, frame);
        } finally {
          image.close();
        }
        return context.getImageData(0, 0, manifest.width, manifest.height).data;
      },
      (stage, completed, total) =>
        ipcRenderer.send(GIF_RENDER_RESPONSE, { kind: 'progress', runId: request.runId, stage, completed, total }),
    );
  } finally {
    background?.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

let busy = false;
ipcRenderer.on(GIF_RENDER_REQUEST, (_event, raw: unknown) => {
  const parsed = gifRenderRequestSchema.safeParse(raw);
  if (!parsed.success || busy) return;
  busy = true;
  void render(parsed.data).then(
    (bytes) => ipcRenderer.send(GIF_RENDER_RESPONSE, { kind: 'complete', runId: parsed.data.runId, bytes }),
    (error) =>
      ipcRenderer.send(GIF_RENDER_RESPONSE, { kind: 'error', runId: parsed.data.runId, error: gifErrorCode(error) }),
  );
});

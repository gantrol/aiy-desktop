import {
  GIF_RENDER_REQUEST,
  GIF_RENDER_RESPONSE,
  gifRenderResponseSchema,
  type GifRenderRequest,
} from '@/shared/gif-render-protocol';
import type { GifProgress } from '@/shared/contracts/gif-making';
import { runGifSandbox } from '@/main/media/gif-sandbox';
export function renderGif(request: GifRenderRequest, signal: AbortSignal, progress: (value: GifProgress) => void) {
  return runGifSandbox<Uint8Array>(
    request,
    signal,
    { request: GIF_RENDER_REQUEST, response: GIF_RENDER_RESPONSE },
    (raw) => {
      const parsed = gifRenderResponseSchema.safeParse(raw);
      if (!parsed.success) throw new Error('GIF_INVALID');
      const value = parsed.data;
      if (value.kind === 'error') throw new Error(value.error);
      if (value.kind === 'complete') return { value: value.bytes };
      progress({ runId: request.runId, stage: value.stage, completed: value.completed, total: value.total });
      return null;
    },
  );
}

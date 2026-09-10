import { runGifSandbox } from '@/main/media/gif-sandbox';
import {
  GIF_FRAME_REQUEST,
  GIF_FRAME_RESPONSE,
  gifFrameResponseSchema,
  type GifFrameRequest,
} from '@/shared/gif-frame-protocol';
export function processGifFrames(request: GifFrameRequest, signal: AbortSignal) {
  return processGifFrameResult(request, signal).then((result) => result.images);
}
export function processGifFrameResult(request: GifFrameRequest, signal: AbortSignal) {
  return runGifSandbox(request, signal, { request: GIF_FRAME_REQUEST, response: GIF_FRAME_RESPONSE }, (raw) => {
    const parsed = gifFrameResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error('GIF_INVALID');
    if (parsed.data.kind === 'error') throw new Error(parsed.data.error);
    return { value: { images: parsed.data.images, audit: parsed.data.audit ?? null } };
  });
}

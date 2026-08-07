import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_DECODER_PIXELS, imageDecoderResponseSchema } from '@/shared/image-decoder-protocol';

function normalizedResponse(width: number, height: number) {
  return {
    requestId: '35c84208-47ba-42d0-9437-e5ca73ecc3b4',
    operation: 'normalize' as const,
    ok: true as const,
    pngBytes: new Uint8Array([1]),
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
  };
}

describe('image decoder pixel boundary', () => {
  it('accepts a 24 megapixel camera image', () => {
    expect(MAX_IMAGE_DECODER_PIXELS).toBeGreaterThanOrEqual(6_000 * 4_000);
    expect(imageDecoderResponseSchema.safeParse(normalizedResponse(6_000, 4_000)).success).toBe(true);
  });

  it('rejects decoded images above the bounded pixel budget', () => {
    expect(imageDecoderResponseSchema.safeParse(normalizedResponse(8_192, 8_192)).success).toBe(false);
  });
});

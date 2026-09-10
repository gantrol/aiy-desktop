import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  GIF_MAX_OUTPUT_BYTES,
  gifPlaybackFrames,
  type GifFrame,
  type GifManifest,
} from '@/shared/contracts/gif-making';
import { gifMetadata } from '@/shared/gif-metadata';

function stablePaletteLookup(palette: number[][]) {
  // gifenc caches the first RGB value encountered in each coarse color bucket.
  // Build that mapping once from fixed representatives, so changing an early
  // pixel cannot change the indices of later, identical pixels in another frame.
  const colors = new Uint8Array(32768 * 4);
  for (let key = 0; key < 32768; key++) {
    colors[key * 4] = ((key >> 10) << 3) | 4;
    colors[key * 4 + 1] = (((key >> 5) & 31) << 3) | 4;
    colors[key * 4 + 2] = ((key & 31) << 3) | 4;
    colors[key * 4 + 3] = 255;
  }
  return applyPalette(colors, palette, 'rgb565');
}

/** Two bounded passes: sample a shared palette, then encode one RGBA frame at a time. */
export async function encodeGif(
  manifest: GifManifest,
  render: (frame: GifFrame) => Promise<Uint8Array | Uint8ClampedArray>,
  progress: (stage: 'PALETTE' | 'ENCODING' | 'VERIFYING', completed: number, total: number) => void,
) {
  const frames = gifPlaybackFrames(manifest);
  if (frames.length < 2) throw new Error('GIF_INVALID');
  const pixels = manifest.width * manifest.height;
  const samplePerFrame = Math.max(1, Math.floor(262_144 / frames.length));
  const samples = new Uint8Array(Math.min(pixels, samplePerFrame) * frames.length * 4);
  let sampled = 0;
  for (let i = 0; i < frames.length; i++) {
    const rgba = await render(frames[i]);
    if (rgba.length !== pixels * 4) throw new Error('GIF_INVALID');
    const count = Math.min(pixels, samplePerFrame);
    for (let j = 0; j < count; j++) {
      const offset = Math.floor((j * pixels) / count) * 4;
      if (rgba[offset + 3] < 128) continue;
      samples.set(rgba.subarray(offset, offset + 4), sampled);
      sampled += 4;
    }
    progress('PALETTE', i + 1, frames.length);
  }
  const opaquePalette = sampled ? quantize(samples.subarray(0, sampled), 255, { format: 'rgb565' }) : [[0, 0, 0]];
  // Match the GIF logical background index (0), so disposal 2 clears transparent frames correctly.
  const transparentIndex = 0;
  const palette = [[0, 0, 0], ...opaquePalette];
  const lookup = stablePaletteLookup(opaquePalette);
  const encoder = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const rgba = await render(frames[i]);
    const index = new Uint8Array(pixels);
    for (let pixel = 0; pixel < pixels; pixel++) {
      const offset = pixel * 4;
      const key = ((rgba[offset] >> 3) << 10) | ((rgba[offset + 1] >> 3) << 5) | (rgba[offset + 2] >> 3);
      index[pixel] = rgba[offset + 3] < 128 ? transparentIndex : lookup[key] + 1;
    }
    encoder.writeFrame(index, manifest.width, manifest.height, {
      ...(i === 0 ? { palette } : {}),
      delay: frames[i].durationMs,
      repeat: manifest.loop === 'FOREVER' ? 0 : -1,
      transparent: true,
      transparentIndex,
      dispose: 2,
    });
    if (encoder.bytesView().length > GIF_MAX_OUTPUT_BYTES) throw new Error('GIF_LIMIT');
    progress('ENCODING', i + 1, frames.length);
  }
  encoder.finish();
  const bytes = encoder.bytes();
  if (bytes.length > GIF_MAX_OUTPUT_BYTES) throw new Error('GIF_LIMIT');
  const metadata = gifMetadata(bytes);
  if (
    metadata.width !== manifest.width ||
    metadata.height !== manifest.height ||
    metadata.durations.length !== frames.length ||
    metadata.durations.some((delay, i) => delay !== frames[i].durationMs) ||
    metadata.loop !== (manifest.loop === 'FOREVER' ? 0 : null)
  )
    throw new Error('GIF_INVALID');
  progress('VERIFYING', frames.length, frames.length);
  return bytes;
}

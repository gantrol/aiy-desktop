import {
  FEATURE_DEMO_DURATION_SECONDS,
  FEATURE_DEMO_FPS,
  FEATURE_DEMO_HEIGHT,
  FEATURE_DEMO_WIDTH,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';
import {
  drawFeatureDemoFrame,
  type FeatureDemoCopy,
} from '@/renderer/features/extensions/feature-demo/featureDemoRenderer';

interface ExportFeatureDemoOptions {
  copy: FeatureDemoCopy;
  signal?: AbortSignal;
  onProgress?(progress: number): void;
}

interface ExportedFeatureDemo {
  buffer: ArrayBuffer;
  extension: 'mp4' | 'webm';
  mimeType: 'video/mp4' | 'video/webm';
}

function exportFileName(extension: ExportedFeatureDemo['extension']) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/u, 'Z');
  return `aiy-feature-demo-2k-${timestamp}.${extension}`;
}

export async function exportFeatureDemoVideo({
  copy,
  signal,
  onProgress,
}: ExportFeatureDemoOptions): Promise<ExportedFeatureDemo> {
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat, canEncodeVideo } =
    await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = FEATURE_DEMO_WIDTH;
  canvas.height = FEATURE_DEMO_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');

  const avcSupported = await canEncodeVideo('avc', {
    width: FEATURE_DEMO_WIDTH,
    height: FEATURE_DEMO_HEIGHT,
    hardwareAcceleration: 'no-preference',
  });
  const vp9Supported = avcSupported
    ? false
    : await canEncodeVideo('vp9', {
        width: FEATURE_DEMO_WIDTH,
        height: FEATURE_DEMO_HEIGHT,
        hardwareAcceleration: 'no-preference',
      });
  if (!avcSupported && !vp9Supported) throw new Error('No 2K video encoder is available');

  const target = new BufferTarget();
  const format = avcSupported ? new Mp4OutputFormat() : new WebMOutputFormat();
  const codec = avcSupported ? ('avc' as const) : ('vp9' as const);
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    quality: new Quality({ bitrate: avcSupported ? 12_000_000 : 10_000_000, bitrateMode: 'variable' }),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
  });
  output.addVideoTrack(source, { frameRate: FEATURE_DEMO_FPS });

  try {
    await output.start();
    const totalFrames = Math.ceil(FEATURE_DEMO_DURATION_SECONDS * FEATURE_DEMO_FPS);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (signal?.aborted) throw new DOMException('Feature demo export was cancelled', 'AbortError');
      const timestamp = frame / FEATURE_DEMO_FPS;
      drawFeatureDemoFrame(context, timestamp, copy);
      await source.add(timestamp, 1 / FEATURE_DEMO_FPS, {
        keyFrame: frame % (FEATURE_DEMO_FPS * 2) === 0,
      });
      if (frame % 10 === 0 || frame === totalFrames - 1) onProgress?.((frame + 1) / totalFrames);
    }
    await output.finalize();
  } catch (error) {
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel();
    throw error;
  }

  if (!target.buffer) throw new Error('Feature demo encoder returned no video');
  return avcSupported
    ? { buffer: target.buffer, extension: 'mp4', mimeType: 'video/mp4' }
    : { buffer: target.buffer, extension: 'webm', mimeType: 'video/webm' };
}

export function downloadFeatureDemoVideo(video: ExportedFeatureDemo) {
  const blob = new Blob([video.buffer], { type: video.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFileName(video.extension);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

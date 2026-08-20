import {
  FEATURE_DEMO_FPS,
  FEATURE_DEMO_HEIGHT,
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  FEATURE_DEMO_WIDTH,
  featureDemoDuration,
  featureDemoSceneAt,
  featureDemoSceneStart,
  type FeatureDemoScene,
  type FeatureDemoSceneId,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

interface ExportFeatureDemoOptions {
  stage: HTMLElement;
  scenes: readonly FeatureDemoScene[];
  renderAt(timeInSeconds: number): Promise<void>;
  signal?: AbortSignal;
  onProgress?(progress: number): void;
}

interface ExportedFeatureDemo {
  buffer: ArrayBuffer;
  extension: 'mp4' | 'webm';
  mimeType: 'video/mp4' | 'video/webm';
}

interface SceneSnapshots {
  from: HTMLCanvasElement;
  to: HTMLCanvasElement;
}

const animatedSceneIds = new Set<FeatureDemoSceneId>([
  'directionDetailsExpand',
  'directionDetailsCollapse',
  'directoryExpand',
  'directoryCollapse',
]);

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ease(value: number) {
  const bounded = clamp(value);
  return bounded < 0.5 ? 4 * bounded * bounded * bounded : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Feature demo export was cancelled', 'AbortError');
}

function exportFileName(extension: ExportedFeatureDemo['extension']) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/u, 'Z');
  return `aiy-feature-demo-2k-${timestamp}.${extension}`;
}

async function waitForStageImages(stage: HTMLElement) {
  const pending = [...stage.querySelectorAll('img')].filter((image) => {
    const style = getComputedStyle(image);
    return style.visibility !== 'hidden' && style.display !== 'none' && !image.complete;
  });
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(pending.map((image) => image.decode().catch(() => undefined))),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
  ]);
}

async function captureSnapshots({ stage, scenes, renderAt, signal, onProgress }: ExportFeatureDemoOptions) {
  const { getFontEmbedCSS, toCanvas } = await import('html-to-image');
  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = await getFontEmbedCSS(stage, { preferredFontFormat: 'woff2' });
  } catch {
    fontEmbedCSS = undefined;
  }

  const capture = async (timeInSeconds: number) => {
    throwIfAborted(signal);
    await renderAt(timeInSeconds);
    await waitForStageImages(stage);
    throwIfAborted(signal);
    return toCanvas(stage, {
      width: FEATURE_DEMO_PREVIEW_WIDTH,
      height: FEATURE_DEMO_PREVIEW_HEIGHT,
      canvasWidth: FEATURE_DEMO_WIDTH,
      canvasHeight: FEATURE_DEMO_HEIGHT,
      pixelRatio: 1,
      skipAutoScale: true,
      cacheBust: false,
      includeQueryParams: true,
      imagePlaceholder: TRANSPARENT_PIXEL,
      backgroundColor: getComputedStyle(stage).backgroundColor,
      fontEmbedCSS,
      skipFonts: !fontEmbedCSS,
      style: { transform: 'none', transformOrigin: 'top left' },
      filter: (node) => !node.hasAttribute('data-feature-demo-cursor'),
    });
  };

  const snapshots = new Map<FeatureDemoSceneId, SceneSnapshots>();
  const capturesRequired = scenes.reduce((count, scene) => count + (animatedSceneIds.has(scene.id) ? 2 : 1), 0);
  let capturesCompleted = 0;

  for (const [sceneIndex, scene] of scenes.entries()) {
    const sceneStart = featureDemoSceneStart(sceneIndex, scenes);
    const margin = Math.min(0.12, scene.durationInSeconds * 0.02);
    if (animatedSceneIds.has(scene.id)) {
      const from = await capture(sceneStart + margin);
      capturesCompleted += 1;
      onProgress?.((capturesCompleted / capturesRequired) * 0.15);
      const to = await capture(sceneStart + scene.durationInSeconds - margin);
      capturesCompleted += 1;
      onProgress?.((capturesCompleted / capturesRequired) * 0.15);
      snapshots.set(scene.id, { from, to });
      continue;
    }
    const frame = await capture(sceneStart + scene.durationInSeconds * 0.5);
    capturesCompleted += 1;
    onProgress?.((capturesCompleted / capturesRequired) * 0.15);
    snapshots.set(scene.id, { from: frame, to: frame });
  }

  return snapshots;
}

function cursorPosition(sceneId: FeatureDemoSceneId, progress: number) {
  if (sceneId === 'directionDetailsExpand') {
    const moved = ease(clamp((progress - 0.04) / 0.3));
    return { x: 1160 + (356 - 1160) * moved, y: 650 + (338 - 650) * moved };
  }
  if (sceneId === 'directionDetailsCollapse') {
    const moved = ease(clamp((progress - 0.18) / 0.42));
    return { x: 356 + (1160 - 356) * moved, y: 338 + (650 - 338) * moved };
  }
  if (sceneId === 'directoryExpand') {
    const approach = ease(clamp((progress - 0.04) / 0.24));
    const gesture = ease(clamp((progress - 0.32) / 0.3));
    return { x: 1160 + (74 - 1160) * approach, y: 650 + (190 - 650) * approach + 46 * gesture };
  }
  const gesture = ease(clamp((progress - 0.32) / 0.3));
  return { x: 74, y: 236 - 82 * gesture };
}

function drawCursor(context: CanvasRenderingContext2D, sceneId: FeatureDemoSceneId, progress: number) {
  const { x, y } = cursorPosition(sceneId, progress);
  context.save();
  context.scale(2, 2);
  context.translate(x, y);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, 30);
  context.lineTo(8, 23);
  context.lineTo(15, 39);
  context.lineTo(23, 35);
  context.lineTo(16, 20);
  context.lineTo(28, 19);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#181614';
  context.lineWidth = 2.5;
  context.fill();
  context.stroke();
  context.restore();
}

function drawDownwardReveal(context: CanvasRenderingContext2D, scene: SceneSnapshots, reveal: number) {
  context.drawImage(scene.from, 0, 0);
  const boundary = FEATURE_DEMO_HEIGHT * reveal;
  context.save();
  context.beginPath();
  context.rect(0, 0, FEATURE_DEMO_WIDTH, boundary);
  context.clip();
  context.drawImage(scene.to, 0, 0);
  context.restore();
}

function drawUpwardCollapse(context: CanvasRenderingContext2D, scene: SceneSnapshots, collapse: number) {
  context.drawImage(scene.from, 0, 0);
  const boundary = FEATURE_DEMO_HEIGHT * (1 - collapse);
  context.save();
  context.beginPath();
  context.rect(0, boundary, FEATURE_DEMO_WIDTH, FEATURE_DEMO_HEIGHT - boundary);
  context.clip();
  context.drawImage(scene.to, 0, 0);
  context.restore();
}

function drawFeatureDemoFrame(
  context: CanvasRenderingContext2D,
  snapshots: ReadonlyMap<FeatureDemoSceneId, SceneSnapshots>,
  timeInSeconds: number,
  scenes: readonly FeatureDemoScene[],
) {
  const position = featureDemoSceneAt(timeInSeconds, scenes);
  const scene = snapshots.get(position.scene.id);
  if (!scene) throw new Error(`Missing feature demo snapshot: ${position.scene.id}`);
  context.clearRect(0, 0, FEATURE_DEMO_WIDTH, FEATURE_DEMO_HEIGHT);

  if (position.scene.id === 'directionDetailsExpand') {
    drawDownwardReveal(context, scene, ease((position.progress - 0.16) / 0.5));
    drawCursor(context, position.scene.id, position.progress);
    return;
  }

  if (position.scene.id === 'directionDetailsCollapse') {
    drawUpwardCollapse(context, scene, ease((position.progress - 0.18) / 0.5));
    drawCursor(context, position.scene.id, position.progress);
    return;
  }

  if (position.scene.id === 'directoryExpand') {
    drawDownwardReveal(context, scene, ease((position.progress - 0.34) / 0.26));
    drawCursor(context, position.scene.id, position.progress);
    return;
  }

  if (position.scene.id === 'directoryCollapse') {
    drawUpwardCollapse(context, scene, ease((position.progress - 0.3) / 0.26));
    drawCursor(context, position.scene.id, position.progress);
    return;
  }

  context.drawImage(scene.from, 0, 0);
}

export async function exportFeatureDemoVideo({
  stage,
  scenes,
  renderAt,
  signal,
  onProgress,
}: ExportFeatureDemoOptions): Promise<ExportedFeatureDemo> {
  const snapshots = await captureSnapshots({ stage, scenes, renderAt, signal, onProgress });
  throwIfAborted(signal);
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
    const totalFrames = Math.ceil(featureDemoDuration(scenes) * FEATURE_DEMO_FPS);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      throwIfAborted(signal);
      const timestamp = frame / FEATURE_DEMO_FPS;
      drawFeatureDemoFrame(context, snapshots, timestamp, scenes);
      await source.add(timestamp, 1 / FEATURE_DEMO_FPS, {
        keyFrame: frame % (FEATURE_DEMO_FPS * 2) === 0,
      });
      if (frame % 10 === 0 || frame === totalFrames - 1) {
        onProgress?.(0.15 + ((frame + 1) / totalFrames) * 0.85);
      }
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

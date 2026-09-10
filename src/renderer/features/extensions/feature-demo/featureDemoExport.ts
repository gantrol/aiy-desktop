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
import {
  featureDemoCaptureProgress,
  featureDemoCursorAt,
} from '@/renderer/features/extensions/feature-demo/featureDemoSceneState';
import { petalDemoCaptureKey } from '@/renderer/features/extensions/feature-demo/featureDemoPetalScene';

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

type SceneSnapshots = Array<{ progress: number; canvas: HTMLCanvasElement }>;

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

async function waitForStageReady(stage: HTMLElement, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      observer.disconnect();
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (
        stage.querySelector(
          '[data-feature-demo-state="error"], [data-codex-image-discovery-configuration][data-load-state="error"]',
        )
      ) {
        finish(new Error('Feature demo content failed to load'));
      } else if (
        !stage.querySelector(
          '[data-feature-demo-state="loading"], [data-codex-image-discovery-configuration][data-load-state="loading"]',
        )
      ) {
        finish();
      }
    };
    const cancel = () => finish(new DOMException('Feature demo export was cancelled', 'AbortError'));
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish(new Error('Feature demo content did not become ready')), 16_000);
    observer.observe(stage, { attributes: true, childList: true, subtree: true });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    else check();
  });
}

async function waitForStageImages(stage: HTMLElement, signal?: AbortSignal) {
  const images = [...stage.querySelectorAll('img')].filter(
    (image) => image.getClientRects().length > 0 && getComputedStyle(image).visibility !== 'hidden',
  );
  if (!images.length) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new DOMException('Feature demo export was cancelled', 'AbortError'));
    const timeout = window.setTimeout(() => finish(new Error('Feature demo images did not become ready')), 10_000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    for (const image of images) image.loading = 'eager';
    void Promise.all(images.map((image) => image.decode())).then(
      () => {
        if (images.some((image) => !image.complete || image.naturalWidth === 0))
          finish(new Error('Feature demo image is unavailable'));
        else finish();
      },
      () => finish(new Error('Feature demo image could not be decoded')),
    );
  });
}

async function createStageCapture({ stage, renderAt, signal }: ExportFeatureDemoOptions) {
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
    await waitForStageReady(stage, signal);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await waitForStageImages(stage, signal);
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
      backgroundColor: getComputedStyle(stage).backgroundColor,
      fontEmbedCSS,
      skipFonts: !fontEmbedCSS,
      style: { transform: 'none', transformOrigin: 'top left' },
      filter: (node) => !node.hasAttribute('data-feature-demo-cursor'),
    });
  };

  return capture;
}

type StageCapture = Awaited<ReturnType<typeof createStageCapture>>;

async function captureSnapshots({ scenes, onProgress }: ExportFeatureDemoOptions, capture: StageCapture) {
  const snapshots = new Map<FeatureDemoSceneId, SceneSnapshots>();
  const capturesRequired = scenes.reduce((count, scene) => count + featureDemoCaptureProgress(scene.id).length, 0);
  let capturesCompleted = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const sceneStart = featureDemoSceneStart(sceneIndex, scenes);
    const frames: SceneSnapshots = [];
    for (const progress of featureDemoCaptureProgress(scene.id)) {
      // Sample just inside the state to avoid floating-point boundary drift.
      const canvas = await capture(sceneStart + (progress + 0.000001) * scene.durationInSeconds);
      frames.push({ progress, canvas });
      capturesCompleted += 1;
      onProgress?.((capturesCompleted / capturesRequired) * 0.15);
    }
    snapshots.set(scene.id, frames);
  }
  return snapshots;
}

/** Keep one rendered motion frame; stationary holds reuse it instead of accumulating 2K canvases. */
function createPetalMotionRenderer(capture: StageCapture) {
  let current: { key: string; canvas: HTMLCanvasElement } | null = null;
  return {
    async draw(context: CanvasRenderingContext2D, time: number, progress: number) {
      const key = petalDemoCaptureKey(progress);
      if (!current || current.key !== key) {
        const canvas = await capture(time);
        if (current) current.canvas.width = current.canvas.height = 0;
        current = { key, canvas };
      }
      context.clearRect(0, 0, FEATURE_DEMO_WIDTH, FEATURE_DEMO_HEIGHT);
      context.drawImage(current.canvas, 0, 0);
      drawCursor(context, 'petalNote', progress);
    },
    dispose() {
      if (current) current.canvas.width = current.canvas.height = 0;
      current = null;
    },
  };
}

function drawCursor(context: CanvasRenderingContext2D, sceneId: FeatureDemoSceneId, progress: number) {
  const position = featureDemoCursorAt(sceneId, progress);
  if (!position) return;
  context.save();
  context.scale(2, 2);
  context.translate(position.x, position.y);
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

function drawFeatureDemoFrame(
  context: CanvasRenderingContext2D,
  snapshots: ReadonlyMap<FeatureDemoSceneId, SceneSnapshots>,
  timeInSeconds: number,
  scenes: readonly FeatureDemoScene[],
) {
  const position = featureDemoSceneAt(timeInSeconds, scenes);
  const frames = snapshots.get(position.scene.id);
  if (!frames?.length) throw new Error(`Missing feature demo snapshot: ${position.scene.id}`);
  const frame = frames.reduce(
    (current, candidate) => (candidate.progress <= position.progress ? candidate : current),
    frames[0]!,
  );
  context.clearRect(0, 0, FEATURE_DEMO_WIDTH, FEATURE_DEMO_HEIGHT);
  context.drawImage(frame.canvas, 0, 0);
  drawCursor(context, position.scene.id, position.progress);
}

export async function exportFeatureDemoVideo({
  stage,
  scenes,
  renderAt,
  signal,
  onProgress,
}: ExportFeatureDemoOptions): Promise<ExportedFeatureDemo> {
  const options = { stage, scenes, renderAt, signal, onProgress };
  const capture = await createStageCapture(options);
  const snapshots = await captureSnapshots(options, capture);
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
  const petalMotion = createPetalMotionRenderer(capture);

  try {
    await output.start();
    const totalFrames = Math.ceil(featureDemoDuration(scenes) * FEATURE_DEMO_FPS);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      throwIfAborted(signal);
      const timestamp = frame / FEATURE_DEMO_FPS;
      const position = featureDemoSceneAt(timestamp, scenes);
      if (position.scene.id === 'petalNote') await petalMotion.draw(context, timestamp, position.progress);
      else drawFeatureDemoFrame(context, snapshots, timestamp, scenes);
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
  } finally {
    petalMotion.dispose();
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

import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';
import { gifMetadata } from '@/shared/gif-metadata';
import {
  IMAGE_DECODER_REQUEST_CHANNEL,
  IMAGE_DECODER_RESPONSE_CHANNEL,
  MAX_IMAGE_DECODER_DIMENSION,
  MAX_IMAGE_DECODER_GIF_FRAMES,
  MAX_IMAGE_DECODER_INPUT_BYTES,
  MAX_IMAGE_DECODER_PIXELS,
  imageDecoderRequestSchema,
  imageDecoderResponseSchema,
  type ImageDecoderFileRequestInput,
  type ImageDecoderRequest,
  type ImageDecoderSourceMimeType,
  type ImageDecoderSuccessResponse,
} from '@/shared/image-decoder-protocol';

const decoderDocument = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; base-uri 'none'; form-action 'none'">`;
const decoderDocumentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(decoderDocument)}`;
const decoderPartition = 'aiy-image-decoder';
const decoderIdleTimeoutMs = 15_000;
const maximumPendingJobs = 16;
const maximumPendingThumbnails = 8;
const maximumInflightByteSourceBytes = 64 * 1024 * 1024;

type QueuedDecodeSource =
  | { kind: 'file'; filePath: string }
  | { kind: 'bytes'; bytes: Uint8Array<ArrayBufferLike>; mimeType: ImageDecoderSourceMimeType };

interface QueuedDecode {
  source: QueuedDecodeSource;
  input: ImageDecoderFileRequestInput;
  timeoutMs: number;
  signal?: AbortSignal;
  consume(response: ImageDecoderSuccessResponse): Promise<unknown>;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  onQueuedAbort?: () => void;
}

let decoderWindow: BrowserWindow | null = null;
let decoderInitialization: Promise<BrowserWindow> | null = null;
let decoderIdleTimer: ReturnType<typeof setTimeout> | null = null;
let activeJob: QueuedDecode | null = null;
let activeController: AbortController | null = null;
let destroyWhenQueueDrains = false;
const pendingJobs: QueuedDecode[] = [];

function cancellationError(signal?: AbortSignal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('Image decoder operation cancelled');
}

function clearIdleTimer() {
  if (!decoderIdleTimer) return;
  clearTimeout(decoderIdleTimer);
  decoderIdleTimer = null;
}

function destroyDecoderWindow() {
  clearIdleTimer();
  const decoder = decoderWindow;
  decoderWindow = null;
  decoderInitialization = null;
  if (decoder && !decoder.isDestroyed()) decoder.destroy();
}

function scheduleIdleDestroy() {
  clearIdleTimer();
  if (!decoderWindow || activeJob || pendingJobs.length) return;
  decoderIdleTimer = setTimeout(() => {
    decoderIdleTimer = null;
    if (!activeJob && !pendingJobs.length) destroyDecoderWindow();
  }, decoderIdleTimeoutMs);
  decoderIdleTimer.unref();
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => finish(() => reject(cancellationError(signal)));
    const finish = (settle: () => void) => {
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function waitForDecoderResponse(decoder: BrowserWindow, request: ImageDecoderRequest, signal: AbortSignal) {
  return new Promise<ImageDecoderSuccessResponse>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(IMAGE_DECODER_RESPONSE_CHANNEL, onResponse);
      decoder.webContents.removeListener('render-process-gone', onRenderProcessGone);
      decoder.removeListener('closed', onClosed);
      signal.removeEventListener('abort', onAbort);
      operation();
    };
    const onResponse = (event: IpcMainEvent, rawResponse: unknown) => {
      if (
        event.sender !== decoder.webContents ||
        event.senderFrame !== decoder.webContents.mainFrame ||
        event.senderFrame.url !== decoder.webContents.getURL()
      ) {
        return;
      }
      const decoded = imageDecoderResponseSchema.safeParse(rawResponse);
      if (
        !decoded.success ||
        decoded.data.requestId !== request.requestId ||
        decoded.data.operation !== request.operation
      ) {
        finish(() => reject(new Error('Image decoder returned an invalid response')));
        return;
      }
      const response = decoded.data;
      if (response.ok === false) {
        finish(() => reject(new Error(response.error)));
        return;
      }
      finish(() => resolve(response));
    };
    const onRenderProcessGone = () => finish(() => reject(new Error('Image decoder renderer exited unexpectedly')));
    const onClosed = () => finish(() => reject(new Error('Image decoder window closed unexpectedly')));
    const onAbort = () => finish(() => reject(cancellationError(signal)));
    ipcMain.on(IMAGE_DECODER_RESPONSE_CHANNEL, onResponse);
    decoder.webContents.once('render-process-gone', onRenderProcessGone);
    decoder.once('closed', onClosed);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      decoder.webContents.send(IMAGE_DECODER_REQUEST_CHANNEL, request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function createDecoderWindow() {
  const owner = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible());
  const decoder = new BrowserWindow({
    ...(owner ? { parent: owner } : {}),
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'image-decoder.js'),
      partition: decoderPartition,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      devTools: false,
      disableDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  decoderWindow = decoder;
  decoder.webContents.setAudioMuted(true);
  decoder.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  decoder.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const decoderSession = decoder.webContents.session;
  decoderSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url !== decoderDocumentUrl && !details.url.startsWith('blob:') });
  });
  decoderSession.setPermissionCheckHandler(() => false);
  decoderSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  decoder.once('closed', () => {
    if (decoderWindow === decoder) decoderWindow = null;
  });
  decoder.webContents.once('render-process-gone', () => {
    if (decoderWindow === decoder) decoderWindow = null;
    if (!decoder.isDestroyed()) decoder.destroy();
  });
  await decoder.loadURL(decoderDocumentUrl);
  if (decoder.isDestroyed() || decoder.webContents.getURL() !== decoderDocumentUrl) {
    throw new Error('Image decoder failed to load its isolated document');
  }
  decoder.webContents.on('will-navigate', (event) => event.preventDefault());
  decoder.webContents.on('will-redirect', (event) => event.preventDefault());
  return decoder;
}

async function decoderForRequest() {
  if (decoderInitialization) return decoderInitialization;
  if (decoderWindow && !decoderWindow.isDestroyed()) return decoderWindow;
  const initialization = createDecoderWindow();
  decoderInitialization = initialization;
  try {
    return await initialization;
  } catch (error) {
    destroyDecoderWindow();
    throw error;
  } finally {
    if (decoderInitialization === initialization) decoderInitialization = null;
  }
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return Math.max(1, a);
}

function matchesSourceDimensions(
  response: ImageDecoderSuccessResponse,
  header: { width: number; height: number },
  sourceMimeType: ImageDecoderSourceMimeType,
) {
  if (sourceMimeType === 'image/svg+xml') return true;
  return (
    (response.sourceWidth === header.width && response.sourceHeight === header.height) ||
    (response.sourceWidth === header.height && response.sourceHeight === header.width)
  );
}

function validateWatermarkAnimation(
  request: Extract<ImageDecoderRequest, { operation: 'watermark' }>,
  response: Extract<ImageDecoderSuccessResponse, { operation: 'watermark' }>,
) {
  if (request.sourceMimeType !== 'image/gif') {
    if (response.outputMimeType === 'image/gif') throw new Error('Image decoder returned an unexpected GIF');
    return;
  }
  if (response.outputMimeType !== 'image/gif') throw new Error('Image decoder flattened an animated GIF');
  const source = gifMetadata(request.sourceBytes, {
    requireFullCanvasFrames: false,
    maxFrames: MAX_IMAGE_DECODER_GIF_FRAMES,
  });
  const output = gifMetadata(response.outputBytes, { maxFrames: MAX_IMAGE_DECODER_GIF_FRAMES });
  if (
    output.width !== source.width ||
    output.height !== source.height ||
    output.loop !== source.loop ||
    output.durations.length !== source.durations.length ||
    output.durations.some((duration, index) => duration !== source.durations[index])
  ) {
    throw new Error('Watermarked GIF does not preserve its source animation');
  }
}

function validateResponseSemantics(
  request: ImageDecoderRequest,
  response: ImageDecoderSuccessResponse,
  header: { width: number; height: number },
) {
  if (!matchesSourceDimensions(response, header, request.sourceMimeType)) {
    throw new Error('Image decoder source dimensions do not match the image header');
  }

  if (request.operation === 'thumbnail') {
    if (response.operation !== 'thumbnail') throw new Error('Image decoder returned the wrong operation');
    const scale = Math.min(1, request.size / Math.max(response.sourceWidth, response.sourceHeight));
    const width = Math.max(1, Math.round(response.sourceWidth * scale));
    const height = Math.max(1, Math.round(response.sourceHeight * scale));
    if (response.width !== width || response.height !== height) {
      throw new Error('Image decoder returned invalid thumbnail dimensions');
    }
    return;
  }

  if (request.operation === 'normalize') {
    if (response.operation !== 'normalize') throw new Error('Image decoder returned the wrong operation');
    if (response.width !== response.sourceWidth || response.height !== response.sourceHeight) {
      throw new Error('Image decoder returned invalid normalized dimensions');
    }
    return;
  }

  if (request.operation === 'watermark') {
    if (response.operation !== 'watermark') throw new Error('Image decoder returned the wrong operation');
    if (response.width !== response.sourceWidth || response.height !== response.sourceHeight) {
      throw new Error('Image decoder returned invalid watermark dimensions');
    }
    validateWatermarkAnimation(request, response);
    return;
  }

  if (response.operation !== 'crop') throw new Error('Image decoder returned the wrong operation');
  const divisor = greatestCommonDivisor(request.ratioWidth, request.ratioHeight);
  const ratioWidth = request.ratioWidth / divisor;
  const ratioHeight = request.ratioHeight / divisor;
  const scale = Math.min(
    Math.floor(response.sourceWidth / ratioWidth),
    Math.floor(response.sourceHeight / ratioHeight),
  );
  if (scale < 1) throw new Error('Requested crop ratio is larger than the source image');
  const cropWidth = ratioWidth * scale;
  const cropHeight = ratioHeight * scale;
  const cropX = Math.floor((response.sourceWidth - cropWidth) / 2);
  const cropY = Math.floor((response.sourceHeight - cropHeight) / 2);
  if (
    response.ratioWidth !== ratioWidth ||
    response.ratioHeight !== ratioHeight ||
    response.width !== cropWidth ||
    response.height !== cropHeight ||
    response.cropWidth !== cropWidth ||
    response.cropHeight !== cropHeight ||
    response.cropX !== cropX ||
    response.cropY !== cropY
  ) {
    throw new Error('Image decoder returned invalid crop geometry');
  }
}

const sourceMimeTypeByExtension: Readonly<Record<string, ImageDecoderSourceMimeType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const extensionBySourceMimeType: Readonly<Record<ImageDecoderSourceMimeType, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

function validateImageHeader(bytes: Buffer, extension: string) {
  const dimensions = imageDimensions(bytes.subarray(0, Math.min(bytes.byteLength, 4 * 1024 * 1024)), extension);
  if (
    !dimensions ||
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_IMAGE_DECODER_DIMENSION ||
    dimensions.height > MAX_IMAGE_DECODER_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_DECODER_PIXELS
  ) {
    throw new Error('Image header is invalid or exceeds the safety limit');
  }
  return dimensions;
}

async function runJob(job: QueuedDecode) {
  const controller = new AbortController();
  activeController = controller;
  const onCallerAbort = () => controller.abort(cancellationError(job.signal));
  if (job.signal?.aborted) onCallerAbort();
  else job.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Image decoder operation timed out')), job.timeoutMs);
  timeout.unref();
  const onOperationAbort = () => destroyDecoderWindow();
  controller.signal.addEventListener('abort', onOperationAbort, { once: true });

  try {
    const sourceBytes =
      job.source.kind === 'file'
        ? await readBoundedImageFile(job.source.filePath, controller.signal)
        : Buffer.from(job.source.bytes.buffer, job.source.bytes.byteOffset, job.source.bytes.byteLength);
    if (!sourceBytes.byteLength || sourceBytes.byteLength > MAX_IMAGE_DECODER_INPUT_BYTES) {
      throw new Error('Image decoder input exceeds the transfer limit');
    }
    const sourceMimeType =
      job.source.kind === 'file'
        ? sourceMimeTypeByExtension[path.extname(job.source.filePath).toLowerCase()]
        : job.source.mimeType;
    if (!sourceMimeType) throw new Error('Image format is unsupported by the sandboxed decoder');
    const header = validateImageHeader(sourceBytes, extensionBySourceMimeType[sourceMimeType]);
    controller.signal.throwIfAborted();
    const request = imageDecoderRequestSchema.parse({
      ...job.input,
      requestId: randomUUID(),
      sourceMimeType,
      sourceBytes,
    });
    const decoder = await abortable(decoderForRequest(), controller.signal);
    const response = await waitForDecoderResponse(decoder, request, controller.signal);
    validateResponseSemantics(request, response, header);
    controller.signal.throwIfAborted();
    const consumed = await job.consume(response);
    controller.signal.throwIfAborted();
    return consumed;
  } catch (error) {
    destroyDecoderWindow();
    if (controller.signal.aborted) throw cancellationError(controller.signal);
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onOperationAbort);
    job.signal?.removeEventListener('abort', onCallerAbort);
    if (activeController === controller) activeController = null;
  }
}

function pumpQueue() {
  if (activeJob) return;
  const job = pendingJobs.shift();
  if (!job) {
    if (destroyWhenQueueDrains) {
      destroyWhenQueueDrains = false;
      destroyDecoderWindow();
      return;
    }
    scheduleIdleDestroy();
    return;
  }
  clearIdleTimer();
  activeJob = job;
  if (job.onQueuedAbort) job.signal?.removeEventListener('abort', job.onQueuedAbort);
  void runJob(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      if (job.input.operation !== 'thumbnail') destroyWhenQueueDrains = true;
      if (activeJob === job) activeJob = null;
      pumpQueue();
    });
}

function enqueueJob(job: QueuedDecode) {
  const pendingThumbnails = pendingJobs.filter((queued) => queued.input.operation === 'thumbnail').length;
  const inflightByteSourceBytes = [activeJob, ...pendingJobs, job].reduce(
    (total, queued) => total + (queued?.source.kind === 'bytes' ? queued.source.bytes.byteLength : 0),
    0,
  );
  if (
    pendingJobs.length >= maximumPendingJobs ||
    (job.input.operation === 'thumbnail' && pendingThumbnails >= maximumPendingThumbnails) ||
    inflightByteSourceBytes > maximumInflightByteSourceBytes
  ) {
    job.reject(new Error('Image decoder queue is full'));
    return;
  }
  const onQueuedAbort = () => {
    const index = pendingJobs.indexOf(job);
    if (index < 0) return;
    pendingJobs.splice(index, 1);
    job.reject(cancellationError(job.signal));
  };
  job.onQueuedAbort = onQueuedAbort;
  if (job.signal?.aborted) {
    job.reject(cancellationError(job.signal));
    return;
  }
  job.signal?.addEventListener('abort', onQueuedAbort, { once: true });

  if (job.input.operation === 'thumbnail') {
    pendingJobs.push(job);
  } else {
    const firstThumbnail = pendingJobs.findIndex((queued) => queued.input.operation === 'thumbnail');
    if (firstThumbnail < 0) pendingJobs.push(job);
    else pendingJobs.splice(firstThumbnail, 0, job);
  }
  pumpQueue();
}

export function withDecodedImageFileInSandbox<T>(
  filePath: string,
  input: ImageDecoderFileRequestInput,
  consume: (response: ImageDecoderSuccessResponse) => Promise<T> | T,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  return decodeInSandbox({ kind: 'file', filePath }, input, consume, timeoutMs, signal);
}

function decodeInSandbox<T>(
  source: QueuedDecodeSource,
  input: ImageDecoderFileRequestInput,
  consume: (response: ImageDecoderSuccessResponse) => Promise<T> | T,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const boundedTimeout = Math.min(120_000, Math.max(1_000, Math.trunc(timeoutMs)));
  return new Promise<T>((resolve, reject) => {
    enqueueJob({
      source,
      input,
      timeoutMs: boundedTimeout,
      signal,
      consume: async (response) => consume(response),
      resolve: (value) => resolve(value as T),
      reject,
    });
  });
}

export function withDecodedImageBytesInSandbox<T>(
  bytes: Uint8Array<ArrayBufferLike>,
  mimeType: ImageDecoderSourceMimeType,
  input: ImageDecoderFileRequestInput,
  consume: (response: ImageDecoderSuccessResponse) => Promise<T> | T,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  return decodeInSandbox({ kind: 'bytes', bytes, mimeType }, input, consume, timeoutMs, signal);
}

export function closeSandboxedImageDecoder(reason = new Error('Image decoder host window closed')) {
  destroyWhenQueueDrains = false;
  activeController?.abort(reason);
  for (const job of pendingJobs.splice(0)) {
    if (job.onQueuedAbort) job.signal?.removeEventListener('abort', job.onQueuedAbort);
    job.reject(reason);
  }
  destroyDecoderWindow();
}

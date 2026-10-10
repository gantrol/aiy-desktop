import { parentPort, workerData } from 'node:worker_threads';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { verifyOnnxRuntime } from '@/main/image-search/native-runtime';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';
import type { ImageSearchEncoder } from '@/main/image-search/encoder';
import { ImageVectorCache } from '@/main/image-search/vector-cache';
import { ContentVectorCache } from '@/main/image-search/content-vector-cache';
import { VideoVectorCache } from '@/main/video-search/vector-cache';
import { videoSearchCommandSchema } from '@/main/video-search/protocol';
import {
  imageSearchCommandSchema,
  type ImageSearchCommand,
  type ImageSearchWorkerConfiguration,
  type ImageSearchWorkerRequest,
  type ImageSearchWorkerResult,
} from '@/main/image-search/worker-protocol';

async function run() {
  if (!parentPort) throw new Error('IMAGE_SEARCH_WORKER_REQUIRED');
  const configuration = workerData as ImageSearchWorkerConfiguration;
  writeWorkerDiagnostic('cache-opening', { role: configuration.role });
  await mkdir(path.dirname(configuration.cachePath), { recursive: true });
  const contentCache =
    configuration.role === 'content'
      ? new ContentVectorCache(configuration.cachePath, configuration.fingerprint)
      : null;
  const cache =
    contentCache || configuration.role === 'prepare' || configuration.role === 'video'
      ? null
      : new ImageVectorCache(configuration.cachePath, configuration.model ? configuration.fingerprint : '');
  const videoCache =
    configuration.role === 'video' ? new VideoVectorCache(configuration.cachePath, configuration.fingerprint) : null;
  writeWorkerDiagnostic('cache-ready', { role: configuration.role });
  let encoder: ImageSearchEncoder | null = null;
  const getEncoder = async () => {
    if (!encoder) {
      if (configuration.role === 'prepare') throw new Error('UNAVAILABLE');
      // Keyword-only search must not load optional ONNX or GPU native libraries.
      writeWorkerDiagnostic('encoder-importing');
      if (configuration.nativeBindingPath) {
        if (
          !path.isAbsolute(configuration.nativeBindingPath) ||
          path.basename(configuration.nativeBindingPath) !== 'onnxruntime_binding.node'
        )
          throw new Error('NOT_CONFIGURED');
        await verifyOnnxRuntime(path.dirname(configuration.nativeBindingPath));
      }
      const { ImageSearchEncoder } = await import('@/main/image-search/encoder');
      encoder = new ImageSearchEncoder(
        configuration.model,
        configuration.role === 'video' ? 'index' : configuration.role,
        configuration.device,
      );
      writeWorkerDiagnostic('encoder-imported');
    }
    return encoder;
  };
  let busy = false;
  const encodeImage = async (command: Extract<ImageSearchCommand, { op: 'index' }>, checkCancelled: () => void) => {
    const item = command.items[0];
    if (!item || !cache?.needsImage(item.id, item.hash)) throw new Error('CHANGED');
    checkCancelled();
    const vector = await (await getEncoder()).image(item.path, checkCancelled);
    checkCancelled();
    return { vector: vector ? Array.from(vector) : null };
  };
  const recognizeImage = async (
    command: Extract<ImageSearchCommand, { op: 'ocr-index' }>,
    checkCancelled: () => void,
  ) => {
    if (!cache?.pendingOcr().some((item) => item.id === command.id && item.hash === command.hash))
      throw new Error('CHANGED');
    if (!command.path) return { status: 'failed', text: null };
    const { recognizeSearchImage } = await import('@/main/image-search/ocr');
    const result = await recognizeSearchImage(command.path, checkCancelled);
    checkCancelled();
    return result;
  };

  const dispatch = async (command: ImageSearchCommand, checkCancelled: () => void) => {
    if (videoCache) return videoCache.search(videoSearchCommandSchema.parse(command), getEncoder, checkCancelled);
    if (configuration.role === 'prepare') {
      if (command.op !== 'prepare') throw new Error('UNAVAILABLE');
      const { prepareImageInput } = await import('@/main/image-search/prepare-input');
      return prepareImageInput(command, path.resolve(configuration.cachePath, '../../..'), checkCancelled);
    }
    if (contentCache) {
      switch (command.op) {
        case 'content-sync-start':
          contentCache.startSync();
          return null;
        case 'content-sync':
          contentCache.synchronize(command.items, checkCancelled);
          return null;
        case 'content-sync-finish':
          contentCache.finishSync();
          return null;
        case 'content-index':
          await contentCache.advance(await getEncoder(), command.type, command.retry, checkCancelled);
          return null;
        case 'content-search':
          return contentCache.search(
            command.query,
            command.type,
            command.offset,
            await getEncoder(),
            checkCancelled,
            command.hybrid,
          );
        default:
          throw new Error('UNAVAILABLE');
      }
    }
    if (!cache) throw new Error('UNAVAILABLE');
    switch (command.op) {
      case 'issues':
        return cache.issues(command.channel, command.after);
      case 'commit-image':
        cache.save(
          command.id,
          command.hash,
          command.vector ? Float32Array.from(command.vector) : null,
          command.failure,
          command.limited,
        );
        break;
      case 'commit-ocr':
        cache.saveOcr(command.id, command.hash, command.text, command.failure, command.limited);
        if (command.failure?.reason === 'OCR_UNAVAILABLE') cache.unavailableOcr();
        break;
      case 'sync-start':
        cache.startSync();
        break;
      case 'sync':
        cache.synchronize(command.items, configuration.role === 'search');
        break;
      case 'sync-finish':
        if (configuration.role === 'search') cache.finishSync();
        break;
      case 'pending':
        return cache.pending();
      case 'retry':
        cache.retry();
        break;
      case 'ocr-pending':
        return cache.pendingOcr();
      case 'ocr-retry':
        cache.retryOcr();
        break;
      case 'ocr-index':
        return recognizeImage(command, checkCancelled);
      case 'index':
        return encodeImage(command, checkCancelled);
      case 'search': {
        const vector = cache.hasVectors() ? await (await getEncoder()).query(command.query) : null;
        return cache.search(command.query, vector, command.offset, checkCancelled, command.hybrid);
      }
      case 'metadata-search':
        return cache.searchMetadata(command.query, command.offset, checkCancelled, command.refresh);
    }
    return null;
  };

  parentPort.on('message', async (request: ImageSearchWorkerRequest) => {
    const respond = (response: ImageSearchWorkerResult) =>
      parentPort!.postMessage({ ...response, execution: encoder?.execution ?? { backend: null, fallback: false } });
    if (busy) {
      respond({ id: request.id, error: 'UNAVAILABLE' });
      return;
    }
    busy = true;
    writeWorkerDiagnostic('command-started', { requestId: request.id, operation: request.command.op });
    try {
      const cancellation = new Int32Array(request.cancellation);
      const checkCancelled = () => {
        if (Atomics.load(cancellation, 0)) throw new Error('CANCELLED');
      };
      checkCancelled();
      const value = await dispatch(imageSearchCommandSchema.parse(request.command), checkCancelled);
      checkCancelled();
      respond({ id: request.id, value });
      writeWorkerDiagnostic('command-finished', { requestId: request.id });
    } catch (error) {
      writeWorkerDiagnostic('command-failed', { requestId: request.id }, error);
      respond({
        id: request.id,
        error:
          error instanceof Error && error.message === 'CANCELLED'
            ? 'CANCELLED'
            : error instanceof Error && error.message === 'CHANGED'
              ? 'CHANGED'
              : error instanceof Error && error.message === 'GPU_UNAVAILABLE'
                ? 'GPU_UNAVAILABLE'
                : 'UNAVAILABLE',
      });
    } finally {
      busy = false;
    }
  });
  parentPort.once('close', () => {
    cache?.close();
    contentCache?.close();
    videoCache?.close();
  });
}

void run().catch((error) => {
  writeWorkerDiagnostic('worker-start-failed', {}, error);
  throw error;
});

import path from 'node:path';
import { access } from 'node:fs/promises';
import { IsolatedExtensionProcess } from '@/main/extensions/isolated-process';
import type { ImageSearchRuntime } from '@/main/image-search/runtime';
import { imageSearchWorkerResponseSchema, type ImageSearchCommand } from '@/main/image-search/worker-protocol';
import type { ImageSearchExecution } from '@/shared/contracts/image-search';
import { IMAGE_PREPARE_TIMEOUT_MS } from '@/main/image-search/input-policy';

/** Cancellation drops work at image/scan boundaries without reloading the model. */
export class ImageSearchWorker {
  private worker: IsolatedExtensionProcess | null = null;
  private pending: {
    id: number;
    inference: boolean;
    signal: AbortSignal;
    resolve(value: unknown): void;
    reject(error: Error): void;
  } | null = null;
  private requesting = false;
  private forceCpu = false;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  generation = 0;
  execution: ImageSearchExecution = { backend: null, fallback: false };

  constructor(
    private runtime: ImageSearchRuntime,
    private cachePath: string,
    private role: 'search' | 'index' | 'content' | 'prepare' | 'video',
  ) {}

  private async start() {
    if (this.worker) return this.worker;
    const generation = this.generation;
    // Shared main/CLI chunks and standalone entries have different output directories.
    let entry = path.join(__dirname, 'image-search-process.js');
    try {
      await access(entry);
    } catch {
      entry = path.join(__dirname, '..', 'image-search-process.js');
    }
    if (this.generation !== generation) throw new Error('CANCELLED');
    const worker = new IsolatedExtensionProcess(entry, `AIY Semantic Search (${this.role})`);
    this.worker = worker;
    this.generation++;
    worker.on('message', (raw: unknown) => {
      if (this.worker !== worker) return;
      const parsed = imageSearchWorkerResponseSchema.safeParse(raw);
      if (!parsed.success) {
        worker.recordDiagnostic('invalid-response');
        this.stop('UNAVAILABLE');
        return;
      }
      const response = parsed.data;
      if (response.id !== this.pending?.id) return;
      this.execution = {
        ...response.execution,
        fallback: response.execution.fallback || (this.forceCpu && response.execution.backend === 'cpu'),
      };
      const pending = this.pending;
      this.pending = null;
      if ('error' in response) {
        pending.reject(new Error(response.error));
        if (this.role === 'prepare') this.stop(response.error);
      } else pending.resolve({ value: response.value });
    });
    const failed = (details: unknown) => {
      if (this.worker !== worker) return;
      console.warn('[image-search] isolated process failed', { role: this.role, details });
      const inference = this.pending?.inference && !this.pending.signal.aborted;
      // A native GPU fault cannot be caught by the encoder. Do not repeatedly
      // enter that backend after the user retries; the catalog is resynced first.
      if (inference && this.runtime.device === 'AUTO') {
        this.forceCpu = true;
        worker.recordDiagnostic('cpu-retry-selected', { requestId: this.pending?.id, role: this.role });
      }
      this.stop(inference && this.runtime.device === 'GPU' ? 'GPU_UNAVAILABLE' : 'UNAVAILABLE');
    };
    worker.on('error', failed);
    worker.on('exit', failed);
    try {
      worker.postMessage({
        kind: 'configure',
        configuration: {
          ...this.runtime,
          device: this.forceCpu ? 'CPU' : this.runtime.device,
          cachePath: this.cachePath,
          role: this.role,
        },
      });
    } catch (error) {
      this.stop('UNAVAILABLE');
      throw error;
    }
    return worker;
  }

  async request(command: ImageSearchCommand, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.requesting) throw new Error('BUSY');
    this.requesting = true;
    if (this.idle) clearTimeout(this.idle);
    let abort: (() => void) | undefined;
    let cancellationTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = this.role === 'prepare' ? IMAGE_PREPARE_TIMEOUT_MS : 180_000;
    const timeout = setTimeout(() => {
      this.worker?.recordDiagnostic('request-timeout', { requestId: this.pending?.id, timeoutMs });
      this.stop(this.role === 'prepare' ? 'INDEX_TIMEOUT' : 'UNAVAILABLE');
    }, timeoutMs);
    try {
      const worker = await this.start();
      signal.throwIfAborted();
      const id = ++this.sequence;
      abort = () => {
        if (this.worker !== worker || this.pending?.id !== id) return;
        if (this.role === 'prepare') {
          this.stop('CANCELLED');
          return;
        }
        try {
          worker.postMessage({ kind: 'cancel', id });
          cancellationTimeout = setTimeout(() => {
            worker.recordDiagnostic('cancellation-timeout', { requestId: id, timeoutMs: 5_000 });
            this.stop('CANCELLED');
          }, 5_000);
        } catch {
          this.stop('CANCELLED');
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      const value = await new Promise((resolve, reject) => {
        this.pending = {
          id,
          inference: ['search', 'index', 'content-search', 'content-index', 'video-search'].includes(command.op),
          signal,
          resolve,
          reject,
        };
        try {
          worker.postMessage({ kind: 'request', id, command });
        } catch {
          this.stop('UNAVAILABLE');
        }
      });
      signal.throwIfAborted();
      return value;
    } finally {
      clearTimeout(timeout);
      clearTimeout(cancellationTimeout);
      if (abort) signal.removeEventListener('abort', abort);
      this.requesting = false;
      if (this.worker) {
        this.idle = setTimeout(() => {
          this.worker?.recordDiagnostic('idle-timeout');
          this.stop();
        }, 5 * 60_000);
        this.idle.unref();
      }
    }
  }

  stop(reason = 'CANCELLED') {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const worker = this.worker;
    const decoding = this.role === 'video' && this.pending;
    if (worker && decoding) {
      try {
        worker.postMessage({ kind: 'cancel', id: decoding.id });
      } catch {
        /* Already stopped. */
      }
    }
    this.worker = null;
    this.execution = { backend: null, fallback: false };
    this.pending?.reject(new Error(reason));
    this.pending = null;
    // Give the video worker time to reap its decoder before terminating the isolated process.
    if (worker && decoding) setTimeout(() => worker.terminate(reason), 1000).unref();
    else worker?.terminate(reason);
    this.generation++;
  }
}

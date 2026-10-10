import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { constants, setPriority } from 'node:os';
import { IMAGE_PREPARE_RSS_BYTES } from '@/main/image-search/input-policy';
import { extensionProcessPort } from '@/main/extensions/process-port';
import { isExtensionDiagnostic } from '@/main/extensions/diagnostic-protocol';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';
import { imageSearchProcessMessageSchema, type ImageSearchWorkerResponse } from '@/main/image-search/worker-protocol';

// Keep atomic cancellation local to the child process. Native inference can block
// its worker thread without blocking cancellation delivery or crashing AIY.
const port = extensionProcessPort();
writeWorkerDiagnostic('bridge-ready');
let worker: Worker | null = null;
let pending: { id: number; cancellation: Int32Array } | null = null;
let preparing = false;
let peakRss = 0;
let started = 0;
port.listen((raw) => {
  const message = imageSearchProcessMessageSchema.parse(raw);
  if (message.kind === 'configure') {
    if (worker) throw new Error('ALREADY_CONFIGURED');
    if (message.configuration.role === 'prepare' || message.configuration.role === 'video') {
      preparing = true;
      const rssLimit = message.configuration.role === 'video' ? 3 * 1024 ** 3 : IMAGE_PREPARE_RSS_BYTES;
      try {
        setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        /* Platform may deny priority changes. */
      }
      // RSS includes libvips and decoder allocations, unlike the JS heap limit. This
      // sampled watchdog is a termination threshold, not an OS-enforced allocation cap.
      const monitor = setInterval(() => {
        if (!pending) return;
        peakRss = Math.max(peakRss, process.memoryUsage.rss());
        if (peakRss <= rssLimit) return;
        const id = pending.id;
        Atomics.store(pending.cancellation, 0, 1);
        pending = null;
        port.send({ id, error: 'RESOURCE_LIMIT', execution: { backend: null, fallback: false } });
        setTimeout(() => process.exit(1), message.configuration.role === 'video' ? 1000 : 100).unref();
      }, 50);
      monitor.unref();
    }
    worker = new Worker(path.join(__dirname, 'image-search-worker.js'), { workerData: message.configuration });
    worker.on('online', () => writeWorkerDiagnostic('worker-online'));
    worker.on('message', (response: ImageSearchWorkerResponse) => {
      if (isExtensionDiagnostic(response)) {
        if (process.env.AIY_EXTENSION_DIAGNOSTICS === '1') port.send(response);
        return;
      }
      if (pending?.id === response.id) {
        if (preparing)
          writeWorkerDiagnostic('prepare-resource-usage', {
            peakRss: Math.max(peakRss, process.memoryUsage.rss()),
            elapsedMs: Date.now() - started,
          });
        pending = null;
      }
      port.send(response);
    });
    worker.on('error', (error) => {
      writeWorkerDiagnostic('worker-failed', {}, error);
      console.error('[image-search] worker failed', error);
      process.exit(1);
    });
    worker.on('exit', (code) => {
      writeWorkerDiagnostic('worker-exited', { code });
      process.exit(code || 1);
    });
    return;
  }
  if (!worker) throw new Error('NOT_CONFIGURED');
  if (message.kind === 'cancel') {
    if (pending?.id === message.id) Atomics.store(pending.cancellation, 0, 1);
    return;
  }
  if (pending) throw new Error('BUSY');
  const cancellation = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  started = Date.now();
  peakRss = process.memoryUsage.rss();
  pending = { id: message.id, cancellation: new Int32Array(cancellation) };
  worker.postMessage({ id: message.id, command: message.command, cancellation });
});

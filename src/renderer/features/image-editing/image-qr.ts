export function recognizeImageQr(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./image-qr.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const finish = (text?: string) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (text === undefined) reject(new Error('IMAGE_QR_FAILED'));
      else resolve(text);
    };
    const cancel = () => finish();
    const timeout = setTimeout(cancel, 30_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = cancel;
    worker.onmessage = (event: MessageEvent<{ text?: string }>) => {
      finish(typeof event.data.text === 'string' && event.data.text.length <= 262144 ? event.data.text : undefined);
    };
    worker.postMessage(blob);
  });
}

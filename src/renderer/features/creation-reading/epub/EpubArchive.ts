import {
  epubLimits,
  type EpubArchiveRequest,
  type EpubArchiveResponse,
} from '@/renderer/features/creation-reading/epub/epubArchiveProtocol';

export class EpubArchive {
  readonly files = new Set<string>();
  #worker = new Worker(new URL('./epubArchive.worker.ts', import.meta.url), { type: 'module' });
  #queue: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #sequence = 0;
  #disposed = false;
  #reject: ((error: Error) => void) | undefined;

  async open(bytes: Uint8Array) {
    const copy = bytes.slice();
    const response = await this.#request({ id: ++this.#sequence, kind: 'OPEN', bytes: copy }, [copy.buffer]);
    if (!('files' in response)) throw new Error('EPUB_INVALID');
    for (const path of response.files) this.files.add(path);
  }

  async read(path: string, limit: number = epubLimits.resource) {
    if (!this.files.has(path)) throw new Error('EPUB_RESOURCE_MISSING');
    const response = await this.#request({ id: ++this.#sequence, kind: 'READ', path, limit });
    if (!('bytes' in response)) throw new Error('EPUB_INVALID');
    return response.bytes;
  }

  #request(request: EpubArchiveRequest, transfer: Transferable[] = []) {
    if (this.#disposed || this.#pending >= 64) return Promise.reject(new Error('EPUB_UNAVAILABLE'));
    this.#pending++;
    const operation = this.#queue.then(
      () =>
        new Promise<EpubArchiveResponse>((resolve, reject) => {
          if (this.#disposed) {
            reject(new Error('EPUB_UNAVAILABLE'));
            return;
          }
          const timeout = setTimeout(() => this.destroy(), 30_000);
          const finish = () => {
            clearTimeout(timeout);
            this.#reject = undefined;
          };
          this.#reject = (error) => {
            finish();
            reject(error);
          };
          this.#worker.onerror = () => this.destroy();
          this.#worker.onmessage = (event: MessageEvent<EpubArchiveResponse>) => {
            if (event.data.id !== request.id) return;
            finish();
            if ('error' in event.data) reject(new Error(event.data.error));
            else resolve(event.data);
          };
          this.#worker.postMessage(request, transfer);
        }),
    );
    this.#queue = operation
      .catch(() => undefined)
      .finally(() => {
        this.#pending--;
      });
    return operation;
  }

  destroy() {
    this.#disposed = true;
    this.#reject?.(new Error('EPUB_UNAVAILABLE'));
    this.#worker.terminate();
    this.files.clear();
  }
}

import JSZip from 'jszip';
import {
  epubLimits,
  type EpubArchiveRequest,
  type EpubArchiveResponse,
} from '@/renderer/features/creation-reading/epub/epubArchiveProtocol';

let archive: JSZip | undefined;
let expanded = 0;
const measured = new Set<string>();
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<EpubArchiveRequest>) => void) | null;
  postMessage(value: EpubArchiveResponse, transfer?: Transferable[]): void;
};

function readEntry(path: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const file = archive?.file(path);
  if (!file || !Number.isInteger(limit) || limit < 1 || limit > epubLimits.resource)
    return Promise.reject(new Error('EPUB_RESOURCE_MISSING'));
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0,
      stopped = false;
    // JSZip documents this browser streaming API but omits it from JSZipObject's types.
    const stream = (
      file as JSZip.JSZipObject & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream('uint8array');
    stream.on('data', (chunk) => {
      if (stopped) return;
      size += chunk.length;
      if (size > limit || (!measured.has(path) && expanded + size > epubLimits.expanded)) {
        stopped = true;
        stream.pause();
        chunks.length = 0;
        reject(new Error('EPUB_LIMIT'));
      } else chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (stopped) return;
      if (!measured.has(path)) {
        measured.add(path);
        expanded += size;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}

async function handle(request: EpubArchiveRequest) {
  if (request.kind === 'OPEN') {
    if (archive || !request.bytes.length || request.bytes.length > epubLimits.archive) throw new Error('EPUB_LIMIT');
    archive = await JSZip.loadAsync(request.bytes, { createFolders: false });
    const files = Object.values(archive.files);
    if (files.length > epubLimits.entries) throw new Error('EPUB_LIMIT');
    for (const file of files) {
      const name = file.name.replace(/\/$/, '');
      if (
        !name ||
        name.length > 1024 ||
        /[\\\x00-\x1f?#:]/u.test(name) ||
        name.startsWith('/') ||
        name.split('/').some((part) => !part || part === '.' || part === '..') ||
        (file.unsafeOriginalName && file.unsafeOriginalName !== file.name)
      )
        throw new Error('EPUB_INVALID');
    }
    const mime = new TextDecoder().decode(await readEntry('mimetype', 64)).trim();
    if (mime !== 'application/epub+zip') throw new Error('EPUB_INVALID');
    worker.postMessage({ id: request.id, files: files.filter((file) => !file.dir).map((file) => file.name) });
  } else {
    const bytes = await readEntry(request.path, request.limit);
    worker.postMessage({ id: request.id, bytes }, [bytes.buffer]);
  }
}

// The client sends one operation at a time, keeping decompression and in-flight buffers bounded.
let busy = false;
worker.onmessage = (event) => {
  const request = event.data;
  if (busy) {
    worker.postMessage({ id: request.id, error: 'EPUB_BUSY' });
    return;
  }
  busy = true;
  void handle(request)
    .catch((error: unknown) => {
      worker.postMessage({
        id: request.id,
        error: error instanceof Error && error.message.startsWith('EPUB_') ? error.message : 'EPUB_INVALID',
      });
    })
    .finally(() => {
      busy = false;
    });
};

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type DownloadFile = readonly [name: string, bytes: number, sha256: string];

export async function verifiedFile(filePath: string, bytes: number, digest: string, signal: AbortSignal) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
    return hash.digest('hex') === digest;
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  }
}

async function fetchFile(url: string, signal: AbortSignal, allowedHost: (host: string) => boolean) {
  for (let hop = 0; hop < 6; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowedHost(parsed.host))
      throw new Error('INVALID_DOWNLOAD_HOST');
    const response = await fetch(url, { signal, redirect: 'manual', credentials: 'omit' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('DOWNLOAD_FAILED');
      url = new URL(location, url).href;
    } else {
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('DOWNLOAD_FAILED');
      }
      return response;
    }
  }
  throw new Error('DOWNLOAD_FAILED');
}

async function* readBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Sequential, backpressured transfer; only a fully verified file becomes loadable. */
export async function downloadVerifiedFiles(options: {
  directory: string;
  files: readonly DownloadFile[];
  baseUrl: string;
  allowedHost: (host: string) => boolean;
  signal: AbortSignal;
  progress: (bytes: number) => void;
}) {
  const { directory, files, baseUrl, allowedHost, signal, progress } = options;
  for (const [name, bytes, digest] of files) {
    signal.throwIfAborted();
    const destination = path.join(directory, name);
    await mkdir(path.dirname(destination), { recursive: true });
    if (await verifiedFile(destination, bytes, digest, signal)) {
      progress(bytes);
      continue;
    }
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      const response = await fetchFile(`${baseUrl}/${name}`, requestSignal, allowedHost);
      const hash = createHash('sha256');
      let received = 0;
      const counter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          received += chunk.length;
          if (received > bytes) {
            callback(new Error('DOWNLOAD_SIZE_MISMATCH'));
            return;
          }
          hash.update(chunk);
          progress(chunk.length);
          callback(null, chunk);
        },
      });
      await pipeline(readBody(response.body!), counter, createWriteStream(temporary, { flags: 'wx' }), {
        signal: requestSignal,
      });
      if (received !== bytes || hash.digest('hex') !== digest) throw new Error('DOWNLOAD_HASH_MISMATCH');
      signal.throwIfAborted();
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

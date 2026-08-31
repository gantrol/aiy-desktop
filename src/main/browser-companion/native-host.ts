import type { Readable, Writable } from 'node:stream';
import {
  BROWSER_COMPANION_PROTOCOL_VERSION,
  BROWSER_COMPANION_EXTENSION_ORIGIN,
  browserCompanionNativeRequestSchema,
  browserCompanionNativeResponseSchema,
  type BrowserCompanionNativeResponse,
} from '@/main/browser-companion/protocol';
import { BrowserCompanionStateError, type BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';

const MAX_NATIVE_REQUEST_BYTES = 64 * 1024;
const MAX_NATIVE_RESPONSE_BYTES = 1024 * 1024;

class InvalidNativeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNativeRequestError';
  }
}

function nativeError(code: Extract<BrowserCompanionNativeResponse, { kind: 'error' }>['code']) {
  return {
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    ok: false,
    kind: 'error',
    code,
  } as const;
}

function readNativeMessage(stream: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let expectedLength: number | null = null;

    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const fail = (reason: Error) => {
      cleanup();
      reject(reason);
    };
    const onError = (reason: Error) => fail(reason);
    const onEnd = () => fail(new InvalidNativeRequestError('Native messaging input ended before one complete message'));
    const onData = (chunk: Buffer | string) => {
      const addition = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes.length + addition.length > MAX_NATIVE_REQUEST_BYTES + 4) {
        fail(new InvalidNativeRequestError('Native messaging request exceeds the local size limit'));
        return;
      }
      bytes = Buffer.concat([bytes, addition]);
      if (expectedLength === null && bytes.length >= 4) {
        expectedLength = bytes.readUInt32LE(0);
        if (expectedLength <= 0 || expectedLength > MAX_NATIVE_REQUEST_BYTES) {
          fail(new InvalidNativeRequestError('Native messaging request length is invalid'));
          return;
        }
      }
      if (expectedLength === null || bytes.length < expectedLength + 4) return;
      if (bytes.length !== expectedLength + 4) {
        fail(new InvalidNativeRequestError('Native messaging request contains trailing bytes'));
        return;
      }

      cleanup();
      try {
        const parsed: unknown = JSON.parse(bytes.subarray(4).toString('utf8'));
        resolve(parsed);
      } catch {
        reject(new InvalidNativeRequestError('Native messaging request is not valid JSON'));
      }
    };

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

function writeNativeMessage(stream: Writable, response: BrowserCompanionNativeResponse): Promise<void> {
  const validated = browserCompanionNativeResponseSchema.parse(response);
  const payload = Buffer.from(JSON.stringify(validated), 'utf8');
  if (payload.length > MAX_NATIVE_RESPONSE_BYTES) {
    throw new Error('Native messaging response exceeds Chrome limit');
  }
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return new Promise((resolve, reject) => {
    stream.write(frame, (reason) => {
      if (reason) reject(reason);
      else resolve();
    });
  });
}

async function handleRequest(
  rawRequest: unknown,
  store: BrowserCompanionHandoffStore,
): Promise<BrowserCompanionNativeResponse> {
  const parsed = browserCompanionNativeRequestSchema.safeParse(rawRequest);
  if (!parsed.success) return nativeError('INVALID_REQUEST');

  switch (parsed.data.kind) {
    case 'claim-handoff':
      return store.claim(parsed.data.target, parsed.data.handoffId);
    case 'claim-latest':
      return store.claim(parsed.data.target);
    case 'read-media-chunk':
      return store.readMediaChunk(
        parsed.data.handoffId,
        parsed.data.completionToken,
        parsed.data.mediaId,
        parsed.data.offset,
        parsed.data.maxBytes,
      );
    case 'complete-handoff':
      return store.complete(parsed.data.handoffId, parsed.data.completionToken);
    case 'release-handoff':
      return store.release(parsed.data.handoffId, parsed.data.completionToken);
  }
}

export async function runBrowserCompanionNativeHost({
  origin,
  store,
  stdin,
  stdout,
}: {
  origin: string;
  store: BrowserCompanionHandoffStore;
  stdin: Readable;
  stdout: Writable;
}): Promise<void> {
  let response: BrowserCompanionNativeResponse;
  try {
    const request = await readNativeMessage(stdin);
    response =
      origin === BROWSER_COMPANION_EXTENSION_ORIGIN ? await handleRequest(request, store) : nativeError('UNAUTHORIZED');
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write('[browser-companion] ' + detail + '\n');
    response = nativeError(
      reason instanceof InvalidNativeRequestError
        ? 'INVALID_REQUEST'
        : reason instanceof BrowserCompanionStateError
          ? 'CORRUPT_STATE'
          : 'INTERNAL_ERROR',
    );
  }
  await writeNativeMessage(stdout, response);
}

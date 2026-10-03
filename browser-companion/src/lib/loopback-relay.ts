import {
  BROWSER_COMPANION_LOOPBACK_ORIGIN,
  BROWSER_COMPANION_MAX_RESPONSE_BYTES,
  BROWSER_COMPANION_MEDIA_PATH,
  BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX,
  BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER,
  BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
  browserCompanionLoopbackEnvelopeSchema,
  resolveSiteFromUrl,
} from '@/lib/protocol';
import {
  LOOPBACK_CHUNK_BYTES,
  LOOPBACK_MAX_MEDIA_BYTES,
  LOOPBACK_TARGET_HEADER,
  LOOPBACK_TIMEOUT_MS,
  LOOPBACK_TRANSFER_PORT,
  decodeLoopbackChunk,
  encodeLoopbackChunk,
  loopbackPortChannel,
  loopbackTransferFrameSchema,
  loopbackTransferRequestSchema,
} from '@/lib/loopback-transfer';

const RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
  'x-aiy-companion-media-id',
  'x-aiy-companion-media-size',
  'x-aiy-companion-media-sha256',
  'x-aiy-companion-media-type',
];
let activeTransfers = 0;

async function relay(port: Browser.runtime.Port): Promise<void> {
  const channel = loopbackPortChannel(port);
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
    channel.close();
  }, 60_000);
  port.onDisconnect.addListener(() => controller.abort());
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const request = loopbackTransferRequestSchema.parse(await channel.receive());
    const sender = port.sender;
    if (
      sender?.id !== browser.runtime.id ||
      !sender.tab ||
      resolveSiteFromUrl(sender.url) !== request.site ||
      resolveSiteFromUrl(sender.tab.url) !== request.site
    ) {
      throw new Error('Untrusted loopback sender');
    }
    const headers = new Headers({ [LOOPBACK_TARGET_HEADER]: request.site });
    let body: string | Blob;
    let path: string;
    if (request.kind === 'signed-request') {
      const envelope = browserCompanionLoopbackEnvelopeSchema.parse(JSON.parse(request.body));
      if (
        envelope.target !== request.site ||
        (envelope.request.kind === 'read-media') !== (request.path === BROWSER_COMPANION_MEDIA_PATH)
      ) {
        throw new Error('Loopback target mismatch');
      }
      path = request.path;
      body = request.body;
      headers.set('Content-Type', 'application/json');
      headers.set(BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER, request.signature);
    } else {
      path = `${BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX}${request.uploadToken}`;
      headers.set('Content-Type', request.mimeType);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      while (received < request.byteSize) {
        const frame = loopbackTransferFrameSchema.parse(await channel.receive({ kind: 'next' }));
        if (frame.kind !== 'chunk') throw new Error('Invalid output upload chunk');
        const bytes = decodeLoopbackChunk(frame.data);
        received += bytes.length;
        if (received > request.byteSize) throw new Error('Output upload is too large');
        chunks.push(bytes);
      }
      const end = loopbackTransferFrameSchema.parse(await channel.receive({ kind: 'uploaded' }));
      if (end.kind !== 'end') throw new Error('Output upload did not finish');
      body = new Blob(chunks, { type: request.mimeType });
    }
    const response = await fetch(`${BROWSER_COMPANION_LOOPBACK_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(LOOPBACK_TIMEOUT_MS)]),
    });
    const limit =
      request.kind === 'signed-request' && request.path === BROWSER_COMPANION_MEDIA_PATH
        ? LOOPBACK_MAX_MEDIA_BYTES
        : BROWSER_COMPANION_MAX_RESPONSE_BYTES;
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
      throw new Error('Loopback response is too large');
    }
    const next = async (frame: unknown) => {
      const message = loopbackTransferFrameSchema.parse(await channel.receive(frame));
      if (message.kind !== 'next') throw new Error('Invalid loopback backpressure acknowledgement');
    };
    await next({
      kind: 'response',
      status: response.status,
      headers: RESPONSE_HEADERS.flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    });
    reader = response.body?.getReader();
    let sent = 0;
    while (reader) {
      const result = await reader.read();
      if (result.done) break;
      sent += result.value.length;
      if (sent > limit || (length !== null && sent > Number(length))) throw new Error('Loopback response is too large');
      for (let offset = 0; offset < result.value.length; offset += LOOPBACK_CHUNK_BYTES) {
        await next({
          kind: 'chunk',
          data: encodeLoopbackChunk(result.value.subarray(offset, offset + LOOPBACK_CHUNK_BYTES)),
        });
      }
    }
    if (length !== null && sent !== Number(length)) throw new Error('Loopback response size changed');
    port.postMessage({ kind: 'end' });
  } catch {
    try {
      port.postMessage({ kind: 'error' });
    } catch {
      /* The document may have navigated away. */
    }
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    channel.close();
  }
}

export function registerLoopbackRelay(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== LOOPBACK_TRANSFER_PORT) return;
    // Bound upload buffers across tabs; downloads stream one acknowledged chunk at a time.
    if (activeTransfers >= 4) {
      port.disconnect();
      return;
    }
    activeTransfers += 1;
    void relay(port).finally(() => {
      activeTransfers -= 1;
    });
  });
}

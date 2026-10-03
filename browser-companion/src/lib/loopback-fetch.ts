import {
  LOOPBACK_CHUNK_BYTES,
  LOOPBACK_MAX_MEDIA_BYTES,
  LOOPBACK_TRANSFER_PORT,
  decodeLoopbackChunk,
  encodeLoopbackChunk,
  loopbackPortChannel,
  loopbackTransferFrameSchema,
  type LoopbackTransferRequest,
} from '@/lib/loopback-transfer';
import { BROWSER_COMPANION_MAX_RESPONSE_BYTES } from '@/lib/protocol';

/** Fetch through the extension origin, independently of the website's loopback permission. */
export async function fetchCompanionLoopback(
  request: LoopbackTransferRequest,
  upload?: ArrayBuffer,
): Promise<Response> {
  const port = browser.runtime.connect({ name: LOOPBACK_TRANSFER_PORT });
  const channel = loopbackPortChannel(port);
  const exchange = async (message: unknown) => loopbackTransferFrameSchema.parse(await channel.receive(message));
  try {
    let frame = await exchange(request);
    if (request.kind === 'output-upload') {
      if (!upload || upload.byteLength !== request.byteSize) throw new Error('Output upload size changed');
      const bytes = new Uint8Array(upload);
      for (let offset = 0; offset < bytes.length; offset += LOOPBACK_CHUNK_BYTES) {
        if (frame.kind !== 'next') throw new Error('Output upload was rejected');
        frame = await exchange({
          kind: 'chunk',
          data: encodeLoopbackChunk(bytes.subarray(offset, offset + LOOPBACK_CHUNK_BYTES)),
        });
      }
      if (frame.kind !== 'uploaded') throw new Error('Output upload was not acknowledged');
      frame = await exchange({ kind: 'end' });
    }
    if (frame.kind !== 'response') throw new Error('Browser companion request failed');
    const headers = new Headers(frame.headers);
    const limit = headers.get('content-type')?.startsWith('application/json')
      ? BROWSER_COMPANION_MAX_RESPONSE_BYTES
      : LOOPBACK_MAX_MEDIA_BYTES;
    const declared = headers.get('content-length');
    const declaredLength = declared === null ? null : Number(declared);
    if (
      declaredLength !== null &&
      (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > limit)
    ) {
      throw new Error('Browser companion response is too large');
    }
    let received = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await exchange({ kind: 'next' });
            if (next.kind === 'end') {
              if (declaredLength !== null && received !== declaredLength)
                throw new Error('Loopback response size changed');
              controller.close();
              channel.close();
            } else if (next.kind === 'chunk') {
              const bytes = decodeLoopbackChunk(next.data);
              received += bytes.length;
              if (received > limit || (declaredLength !== null && received > declaredLength))
                throw new Error('Loopback response is too large');
              controller.enqueue(bytes);
            } else throw new Error('Browser companion transfer failed');
          } catch (reason) {
            controller.error(reason);
            channel.close();
          }
        },
        cancel() {
          channel.close();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: frame.status, headers });
  } catch (reason) {
    channel.close();
    throw reason;
  }
}

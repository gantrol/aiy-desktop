import { z } from 'zod';
import {
  BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES,
  BROWSER_COMPANION_MEDIA_PATH,
  BROWSER_COMPANION_REQUEST_PATH,
  companionSiteSchema,
} from '@/lib/protocol';

export const LOOPBACK_TRANSFER_PORT = 'aiy-loopback-transfer';
export const LOOPBACK_CHUNK_BYTES = 192 * 1024;
export const LOOPBACK_TARGET_HEADER = 'x-aiy-companion-target';
export const LOOPBACK_TIMEOUT_MS = 20_000;
export const LOOPBACK_MAX_MEDIA_BYTES = 32 * 1024 * 1024;

export const loopbackTransferRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('signed-request'),
      site: companionSiteSchema,
      path: z.enum([BROWSER_COMPANION_REQUEST_PATH, BROWSER_COMPANION_MEDIA_PATH]),
      body: z.string().max(64 * 1024),
      signature: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('output-upload'),
      site: z.literal('chatgpt'),
      uploadToken: z.string().uuid(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      byteSize: z.number().int().positive().max(BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES),
    })
    .strict(),
]);
export type LoopbackTransferRequest = z.infer<typeof loopbackTransferRequestSchema>;

export const loopbackTransferFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('next') }).strict(),
  z.object({ kind: z.literal('uploaded') }).strict(),
  z.object({ kind: z.literal('end') }).strict(),
  z.object({ kind: z.literal('error') }).strict(),
  z
    .object({
      kind: z.literal('chunk'),
      data: z
        .string()
        .min(4)
        .max(4 * Math.ceil(LOOPBACK_CHUNK_BYTES / 3))
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('response'),
      status: z.number().int().min(200).max(599),
      headers: z.array(z.tuple([z.string().max(100), z.string().max(512)])).max(16),
    })
    .strict(),
]);

export function encodeLoopbackChunk(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function decodeLoopbackChunk(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  if (binary.length > LOOPBACK_CHUNK_BYTES) throw new Error('Loopback chunk is too large');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** One outstanding exchange keeps Chrome's JSON message queue bounded. */
export function loopbackPortChannel(port: Browser.runtime.Port) {
  let pending: { resolve(value: unknown): void; reject(reason: Error): void } | null = null;
  let closed = false;
  const fail = () => {
    closed = true;
    pending?.reject(new Error('Browser companion transfer disconnected'));
    pending = null;
  };
  port.onDisconnect.addListener(fail);
  port.onMessage.addListener((message: unknown) => {
    if (!pending) {
      fail();
      port.disconnect();
      return;
    }
    const receiver = pending;
    pending = null;
    receiver.resolve(message);
  });
  return {
    receive(send?: unknown): Promise<unknown> {
      if (closed || pending) return Promise.reject(new Error('Browser companion transfer is not ready'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail();
          port.disconnect();
        }, LOOPBACK_TIMEOUT_MS);
        pending = {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(reason) {
            clearTimeout(timer);
            reject(reason);
          },
        };
        if (send !== undefined) {
          try {
            port.postMessage(send);
          } catch {
            fail();
          }
        }
      });
    },
    close() {
      fail();
      port.disconnect();
    },
  };
}

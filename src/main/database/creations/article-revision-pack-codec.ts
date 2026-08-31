import { createHash } from 'node:crypto';
import { brotliCompress, brotliDecompress, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import {
  articleContentSchema,
  canonicalArticleContentJson,
  type ArticleContentInput,
} from '@/shared/contracts/article';
import { sha256HexAsync } from '@/main/database/core/storage';

export const ARTICLE_REVISION_PACK_CODEC = 'BROTLI_JSON_V1';
export const ARTICLE_REVISION_PACK_IDLE_MS = 30_000;
export const ARTICLE_REVISION_PACK_HOT_REVISIONS = 16;
export const ARTICLE_REVISION_PACK_MIN_ENTRIES = 8;
export const ARTICLE_REVISION_PACK_MAX_ENTRIES = 64;
export const ARTICLE_REVISION_PACK_MIN_SOURCE_BYTES = 64 * 1024;
export const ARTICLE_REVISION_PACK_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;
export const ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const packEntrySchema = z
  .object({
    revisionId: z.string().min(1),
    revisionNo: z.number().int().positive(),
    contentHash: sha256Schema,
    content: articleContentSchema,
  })
  .strict();
const packEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    articleId: z.string().min(1),
    entries: z.array(packEntrySchema).min(1).max(ARTICLE_REVISION_PACK_MAX_ENTRIES),
  })
  .strict();
const binarySchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: 'Stored article revision pack payload is invalid',
});
const storedPackRowSchema = z
  .object({
    id: z.string().min(1),
    article_id: z.string().min(1),
    codec: z.literal(ARTICLE_REVISION_PACK_CODEC),
    payload: binarySchema,
    payload_hash: sha256Schema,
    entry_count: z.number().int().min(1).max(ARTICLE_REVISION_PACK_MAX_ENTRIES),
    first_revision_no: z.number().int().positive(),
    last_revision_no: z.number().int().positive(),
    uncompressed_bytes: z.number().int().positive().max(ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES),
    compressed_bytes: z.number().int().positive().max(ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES),
    created_at: z.string().min(1),
  })
  .strict();

export type ArticleRevisionPackEntry = z.infer<typeof packEntrySchema>;
export type ArticleRevisionPackEnvelope = z.infer<typeof packEnvelopeSchema>;

export interface ArticleRevisionContentLocator {
  articleId: string;
  revisionId: string;
  revisionNo: number;
  contentJson: unknown;
  contentHash: string;
  packId: string | null;
  packEntryIndex: number | null;
}

export interface EncodedArticleRevisionPack {
  payload: Buffer;
  payloadHash: string;
  uncompressedBytes: number;
  compressedBytes: number;
}

function sha256Hex(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseEnvelopeBytes(bytes: Uint8Array) {
  if (bytes.byteLength <= 0 || bytes.byteLength > ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES) {
    throw new Error('Stored article revision pack exceeds its uncompressed bound');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error('Stored article revision pack is invalid');
  }
  return packEnvelopeSchema.parse(parsed);
}

function assertEnvelopeOrdering(envelope: ArticleRevisionPackEnvelope) {
  const revisionIds = new Set<string>();
  let previousRevisionNo = 0;
  for (const entry of envelope.entries) {
    if (
      revisionIds.has(entry.revisionId) ||
      entry.revisionNo <= previousRevisionNo ||
      sha256Hex(canonicalArticleContentJson(entry.content)) !== entry.contentHash
    ) {
      throw new Error('Stored article revision pack ordering is invalid');
    }
    revisionIds.add(entry.revisionId);
    previousRevisionNo = entry.revisionNo;
  }
}

function decompressAsync(payload: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    brotliDecompress(payload, { maxOutputLength: ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function compressAsync(source: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    brotliCompress(
      source,
      {
        params: {
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
        },
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

export function parseStandaloneArticleRevisionContent(contentJson: unknown) {
  if (typeof contentJson !== 'string' || contentJson.length === 0) throw new Error('Stored article is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson) as unknown;
  } catch {
    throw new Error('Stored article is invalid');
  }
  return articleContentSchema.parse(parsed);
}

export function parseVerifiedStandaloneArticleRevisionContent(contentJson: unknown, expectedHash: string) {
  const content = parseStandaloneArticleRevisionContent(contentJson);
  if (sha256Hex(canonicalArticleContentJson(content)) !== expectedHash) {
    throw new Error('Stored article content hash is invalid');
  }
  return content;
}

export async function encodeArticleRevisionPack(envelopeInput: ArticleRevisionPackEnvelope) {
  const envelope = packEnvelopeSchema.parse(envelopeInput);
  assertEnvelopeOrdering(envelope);
  const source = Buffer.from(JSON.stringify(envelope), 'utf8');
  if (source.byteLength > ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES) {
    throw new Error('Article revision pack exceeds its uncompressed bound');
  }
  const payloadHash = await sha256HexAsync(source);
  const payload = await compressAsync(source);
  if (payload.byteLength <= 0 || payload.byteLength > ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES) {
    throw new Error('Article revision pack exceeds its compressed bound');
  }
  const verified = await decompressAsync(payload);
  if (!verified.equals(source)) throw new Error('Article revision pack did not round trip');
  const decoded = parseEnvelopeBytes(verified);
  assertEnvelopeOrdering(decoded);
  return {
    payload,
    payloadHash,
    uncompressedBytes: source.byteLength,
    compressedBytes: payload.byteLength,
  } satisfies EncodedArticleRevisionPack;
}

export function decodePackedArticleRevisionContent(rowInput: unknown, locator: ArticleRevisionContentLocator) {
  const row = storedPackRowSchema.parse(rowInput);
  const payload = Buffer.from(row.payload.buffer, row.payload.byteOffset, row.payload.byteLength);
  if (row.id !== locator.packId || row.article_id !== locator.articleId) {
    throw new Error('Stored article revision pack identity is invalid');
  }
  if (payload.byteLength !== row.compressed_bytes) {
    throw new Error('Stored article revision pack size is invalid');
  }
  const source = brotliDecompressSync(payload, {
    maxOutputLength: ARTICLE_REVISION_PACK_MAX_ENVELOPE_BYTES,
  });
  if (source.byteLength !== row.uncompressed_bytes || sha256Hex(source) !== row.payload_hash) {
    throw new Error('Stored article revision pack hash is invalid');
  }
  const envelope = parseEnvelopeBytes(source);
  assertEnvelopeOrdering(envelope);
  const first = envelope.entries.at(0);
  const last = envelope.entries.at(-1);
  if (
    envelope.articleId !== locator.articleId ||
    envelope.entries.length !== row.entry_count ||
    first?.revisionNo !== row.first_revision_no ||
    last?.revisionNo !== row.last_revision_no
  ) {
    throw new Error('Stored article revision pack metadata is invalid');
  }
  const entry = envelope.entries[locator.packEntryIndex ?? -1];
  if (
    !entry ||
    entry.revisionId !== locator.revisionId ||
    entry.revisionNo !== locator.revisionNo ||
    entry.contentHash !== locator.contentHash ||
    sha256Hex(canonicalArticleContentJson(entry.content)) !== locator.contentHash
  ) {
    throw new Error('Stored article revision pack entry is invalid');
  }
  return entry.content satisfies ArticleContentInput;
}

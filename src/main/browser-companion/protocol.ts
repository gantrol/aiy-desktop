import { z } from 'zod';
import {
  browserCompanionContentKindSchema,
  browserCompanionSourceSchema,
  browserCompanionTargetSchema,
} from '@/shared/contracts/browser-companion';

export const BROWSER_COMPANION_PROTOCOL_VERSION = 4 as const;
export const BROWSER_COMPANION_NATIVE_HOST_NAME = 'com.catai.aiy.browser_companion';
export const BROWSER_COMPANION_EXTENSION_ORIGIN = 'chrome-extension://eagfpifnbkfmojcjfbababmlmagmdopg/';
export const BROWSER_COMPANION_MEDIA_CHUNK_BYTES = 512 * 1024;
export const BROWSER_COMPANION_MAX_MEDIA_BYTES = 32 * 1024 * 1024;
export const BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES = 128 * 1024 * 1024;

export const browserCompanionMediaMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export const browserCompanionMediaSchema = z
  .object({
    mediaId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(240),
    mimeType: browserCompanionMediaMimeTypeSchema,
    byteSize: z.number().int().positive().max(BROWSER_COMPANION_MAX_MEDIA_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const currentRecordFields = {
  schemaVersion: z.literal(4),
  handoffId: z.string().uuid(),
  target: browserCompanionTargetSchema,
  source: browserCompanionSourceSchema,
  contentKind: browserCompanionContentKindSchema,
  title: z.string().trim().min(1).max(200).nullable(),
  text: z.string().min(1).max(10_000),
  media: z.array(browserCompanionMediaSchema).max(20),
  createdAt: z.string().datetime({ offset: true }),
} as const;

export const browserCompanionRecordBaseSchema = z.object(currentRecordFields).strict();

export const browserCompanionClaimedRecordSchema = browserCompanionRecordBaseSchema
  .extend({
    completionToken: z.string().uuid(),
    claimedAt: z.string().datetime({ offset: true }),
    leaseExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const browserCompanionDeliveredRecordSchema = browserCompanionRecordBaseSchema
  .extend({
    claimedAt: z.string().datetime({ offset: true }),
    deliveredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const browserCompanionRecordSchema = z.union([
  browserCompanionRecordBaseSchema,
  browserCompanionClaimedRecordSchema,
  browserCompanionDeliveredRecordSchema,
]);

const legacyRecordV3BaseSchema = z
  .object({
    schemaVersion: z.literal(3),
    handoffId: z.string().uuid(),
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    text: z.string().min(1).max(10_000),
    media: z.array(browserCompanionMediaSchema).max(18),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

const legacyRecordV3ClaimedSchema = legacyRecordV3BaseSchema
  .extend({
    completionToken: z.string().uuid(),
    claimedAt: z.string().datetime({ offset: true }),
    leaseExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const legacyRecordV3DeliveredSchema = legacyRecordV3BaseSchema
  .extend({
    claimedAt: z.string().datetime({ offset: true }),
    deliveredAt: z.string().datetime({ offset: true }),
  })
  .strict();

const legacyRecordV2BaseSchema = z
  .object({
    schemaVersion: z.literal(2),
    handoffId: z.string().uuid(),
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    text: z.string().min(1).max(10_000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

const legacyRecordV2ClaimedSchema = legacyRecordV2BaseSchema
  .extend({
    completionToken: z.string().uuid(),
    claimedAt: z.string().datetime({ offset: true }),
    leaseExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const legacyRecordV2DeliveredSchema = legacyRecordV2BaseSchema
  .extend({
    claimedAt: z.string().datetime({ offset: true }),
    deliveredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const browserCompanionPersistedRecordSchema = z.union([
  browserCompanionRecordSchema,
  legacyRecordV3BaseSchema,
  legacyRecordV3ClaimedSchema,
  legacyRecordV3DeliveredSchema,
  legacyRecordV2BaseSchema,
  legacyRecordV2ClaimedSchema,
  legacyRecordV2DeliveredSchema,
]);

export function normalizeBrowserCompanionRecord(
  record: z.infer<typeof browserCompanionPersistedRecordSchema>,
): BrowserCompanionRecord {
  if (record.schemaVersion === 4) return record;
  return browserCompanionRecordSchema.parse({
    ...record,
    schemaVersion: 4,
    title: null,
    media: record.schemaVersion === 3 ? record.media : [],
  });
}

const authenticatedRequestFields = {
  protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
  handoffId: z.string().uuid(),
  completionToken: z.string().uuid(),
} as const;

export const browserCompanionNativeRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      kind: z.literal('claim-handoff'),
      handoffId: z.string().uuid(),
      target: browserCompanionTargetSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      kind: z.literal('claim-latest'),
      target: browserCompanionTargetSchema,
    })
    .strict(),
  z
    .object({
      ...authenticatedRequestFields,
      kind: z.literal('read-media-chunk'),
      mediaId: z.string().uuid(),
      offset: z.number().int().nonnegative().max(BROWSER_COMPANION_MAX_MEDIA_BYTES),
      maxBytes: z.number().int().positive().max(BROWSER_COMPANION_MEDIA_CHUNK_BYTES),
    })
    .strict(),
  z
    .object({
      ...authenticatedRequestFields,
      kind: z.literal('complete-handoff'),
    })
    .strict(),
  z
    .object({
      ...authenticatedRequestFields,
      kind: z.literal('release-handoff'),
    })
    .strict(),
]);

const nativeHandoffSchema = browserCompanionClaimedRecordSchema
  .omit({ schemaVersion: true, leaseExpiresAt: true })
  .strict();

export const browserCompanionNativeResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('handoff'),
      handoff: nativeHandoffSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('media-chunk'),
      handoffId: z.string().uuid(),
      mediaId: z.string().uuid(),
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative(),
      eof: z.boolean(),
      base64: z.string().max(Math.ceil((BROWSER_COMPANION_MEDIA_CHUNK_BYTES * 4) / 3) + 4),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('empty'),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.enum(['completed', 'released']),
      handoffId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(false),
      kind: z.literal('error'),
      code: z.enum([
        'INVALID_REQUEST',
        'UNAUTHORIZED',
        'TARGET_MISMATCH',
        'DRAFT_ALREADY_CLAIMED',
        'HANDOFF_NOT_FOUND',
        'HANDOFF_TOKEN_MISMATCH',
        'MEDIA_NOT_FOUND',
        'MEDIA_CHANGED',
        'STATE_CONFLICT',
        'CORRUPT_STATE',
        'INTERNAL_ERROR',
      ]),
    })
    .strict(),
]);

export type BrowserCompanionRecord = z.infer<typeof browserCompanionRecordSchema>;
export type BrowserCompanionRecordBase = z.infer<typeof browserCompanionRecordBaseSchema>;
export type BrowserCompanionClaimedRecord = z.infer<typeof browserCompanionClaimedRecordSchema>;
export type BrowserCompanionDeliveredRecord = z.infer<typeof browserCompanionDeliveredRecordSchema>;
export type BrowserCompanionMedia = z.infer<typeof browserCompanionMediaSchema>;
export type BrowserCompanionMediaMimeType = z.infer<typeof browserCompanionMediaMimeTypeSchema>;
export type BrowserCompanionNativeRequest = z.infer<typeof browserCompanionNativeRequestSchema>;
export type BrowserCompanionNativeResponse = z.infer<typeof browserCompanionNativeResponseSchema>;

export function browserCompanionNativeOrigin(argv: readonly string[]): string | null {
  return argv.find((argument) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(argument)) ?? null;
}

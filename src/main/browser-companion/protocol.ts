import { z } from 'zod';
import {
  browserCompanionContentKindSchema,
  browserCompanionSourceSchema,
  browserCompanionTargetSchema,
} from '@/shared/contracts/browser-companion';

export const BROWSER_COMPANION_PROTOCOL_VERSION = 5 as const;
export const BROWSER_COMPANION_EXTENSION_ID = 'eagfpifnbkfmojcjfbababmlmagmdopg';
export const BROWSER_COMPANION_EXTENSION_ORIGIN = `chrome-extension://${BROWSER_COMPANION_EXTENSION_ID}/`;
export const BROWSER_COMPANION_LOOPBACK_HOST = '127.0.0.1';
export const BROWSER_COMPANION_LOOPBACK_PORT = 47_831;
export const BROWSER_COMPANION_LOOPBACK_ORIGIN =
  `http://${BROWSER_COMPANION_LOOPBACK_HOST}:${BROWSER_COMPANION_LOOPBACK_PORT}` as const;
export const BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX = '/v1/connect/';
export const BROWSER_COMPANION_REQUEST_PATH = '/v1/requests';
export const BROWSER_COMPANION_MEDIA_PATH = '/v1/media';
export const BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX = '/v1/output-imports/';
export const BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER = 'x-aiy-companion-signature';
export const BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER = 'x-aiy-companion-response-signature';
export const BROWSER_COMPANION_MAX_MEDIA_BYTES = 32 * 1024 * 1024;
export const BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES = 128 * 1024 * 1024;
export const BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES = 25 * 1024 * 1024;
export const BROWSER_COMPANION_MAX_REQUEST_BYTES = 64 * 1024;
export const BROWSER_COMPANION_MAX_RESPONSE_BYTES = 64 * 1024;
export const BROWSER_COMPANION_REQUEST_CLOCK_SKEW_MS = 60_000;

export function resolveBrowserCompanionLoopbackPort(environment: NodeJS.ProcessEnv): number {
  if (environment.AIY_E2E !== '1') return BROWSER_COMPANION_LOOPBACK_PORT;
  const configured = environment.AIY_BROWSER_COMPANION_LOOPBACK_PORT?.trim();
  if (!configured) return BROWSER_COMPANION_LOOPBACK_PORT;
  if (!/^\d{4,5}$/.test(configured)) throw new Error('Invalid browser companion E2E loopback port');
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('Invalid browser companion E2E loopback port');
  }
  return port;
}

const browserCompanionWebOriginTarget = {
  'https://chatgpt.com': 'chatgpt',
  'https://mp.weixin.qq.com': 'wechat',
  'https://weibo.com': 'weibo',
  'https://www.weibo.com': 'weibo',
} as const;

export function browserCompanionTargetFromWebOrigin(value: string | undefined) {
  if (!value) return null;
  return browserCompanionWebOriginTarget[value as keyof typeof browserCompanionWebOriginTarget] ?? null;
}

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

export const browserCompanionOutputImageSchema = z
  .object({
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    byteSize: z.number().int().positive().max(BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const chatGptConversationUrlSchema = z
  .string()
  .url()
  .max(4_096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.origin === 'https://chatgpt.com' && !url.username && !url.password;
    } catch {
      return false;
    }
  });

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

export const browserCompanionRequestSchema = z.discriminatedUnion('kind', [
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
      kind: z.literal('complete-handoff'),
    })
    .strict(),
  z
    .object({
      ...authenticatedRequestFields,
      kind: z.literal('release-handoff'),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      kind: z.literal('prepare-output-import'),
      handoffId: z.string().uuid(),
      sourceUrl: chatGptConversationUrlSchema,
      image: browserCompanionOutputImageSchema,
    })
    .strict(),
]);

export const browserCompanionMediaRequestSchema = z
  .object({
    ...authenticatedRequestFields,
    kind: z.literal('read-media'),
    mediaId: z.string().uuid(),
  })
  .strict();

export const browserCompanionLoopbackEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    sentAt: z.number().int().nonnegative(),
    nonce: z.string().uuid(),
    target: browserCompanionTargetSchema,
    request: z.union([browserCompanionRequestSchema, browserCompanionMediaRequestSchema]),
  })
  .strict();

export const browserCompanionBridgeCredentialsSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const handoffSchema = browserCompanionClaimedRecordSchema.omit({ schemaVersion: true, leaseExpiresAt: true }).strict();

export const browserCompanionResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('handoff'),
      handoff: handoffSchema,
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
      ok: z.literal(true),
      kind: z.literal('output-import-ready'),
      handoffId: z.string().uuid(),
      uploadToken: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('output-imported'),
      handoffId: z.string().uuid(),
      seriesId: z.string().min(1).max(200),
      promptVersionId: z.string().min(1).max(200),
      imageAssetId: z.string().min(1).max(200),
      adopted: z.boolean(),
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
        'OUTPUT_IMPORT_NOT_ALLOWED',
        'OUTPUT_UPLOAD_NOT_FOUND',
        'OUTPUT_UPLOAD_CHANGED',
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
export type BrowserCompanionOutputImage = z.infer<typeof browserCompanionOutputImageSchema>;
export type BrowserCompanionRequest = z.infer<typeof browserCompanionRequestSchema>;
export type BrowserCompanionMediaRequest = z.infer<typeof browserCompanionMediaRequestSchema>;
export type BrowserCompanionLoopbackEnvelope = z.infer<typeof browserCompanionLoopbackEnvelopeSchema>;
export type BrowserCompanionBridgeCredentials = z.infer<typeof browserCompanionBridgeCredentialsSchema>;
export type BrowserCompanionResponse = z.infer<typeof browserCompanionResponseSchema>;

import { z } from 'zod';

declare const __AIY_BROWSER_COMPANION_LOOPBACK_PORT__: number;

export const BROWSER_COMPANION_PROTOCOL_VERSION = 6 as const;
export const BROWSER_COMPANION_LOOPBACK_PORT = __AIY_BROWSER_COMPANION_LOOPBACK_PORT__;
export const BROWSER_COMPANION_LOOPBACK_ORIGIN = `http://127.0.0.1:${BROWSER_COMPANION_LOOPBACK_PORT}` as const;
export const BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX = '/v1/connect/';
export const BROWSER_COMPANION_REQUEST_PATH = '/v1/requests';
export const BROWSER_COMPANION_MEDIA_PATH = '/v1/media';
export const BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX = '/v1/output-imports/';
export const BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER = 'x-aiy-companion-signature';
export const BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER = 'x-aiy-companion-response-signature';
export const BROWSER_COMPANION_CONNECTION_STORAGE_KEY = 'aiy-browser-companion-connection-v1';
export const BROWSER_COMPANION_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES = 25 * 1024 * 1024;

export const companionSiteSchema = z.enum(['chatgpt', 'wechat', 'weibo', 'x', 'xiaohongshu']);
export type CompanionSite = z.infer<typeof companionSiteSchema>;

export const fillDraftRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal('fill-draft'),
    requestId: z.string().uuid(),
    draft: z.string().trim().min(1).max(10_000),
  })
  .strict();

export type FillDraftRequest = z.infer<typeof fillDraftRequestSchema>;

export const fillDraftErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNSUPPORTED_SITE',
  'BUSY',
  'COMPOSER_NOT_FOUND',
  'COMPOSER_AMBIGUOUS',
  'COMPOSER_NOT_EMPTY',
  'MEDIA_INPUT_NOT_FOUND',
  'MEDIA_FILL_FAILED',
  'MEDIA_UNSUPPORTED',
  'COMPOSER_HAS_MEDIA',
  'FILL_FAILED',
  'XIAOHONGSHU_TITLE_TOO_LONG',
  'XIAOHONGSHU_BODY_TOO_LONG',
  'XIAOHONGSHU_MEDIA_UNSUPPORTED',
  'XIAOHONGSHU_LOGIN_REQUIRED',
]);

export type FillDraftErrorCode = z.infer<typeof fillDraftErrorCodeSchema>;

export const fillDraftResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      requestId: z.string().uuid(),
      site: companionSiteSchema,
      characterCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      requestId: z.string().uuid().nullable(),
      site: companionSiteSchema.nullable(),
      code: fillDraftErrorCodeSchema,
    })
    .strict(),
]);

export type FillDraftResponse = z.infer<typeof fillDraftResponseSchema>;

export const consumeHandoffRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal('consume-handoff'),
    requestId: z.string().uuid(),
    handoffId: z.string().uuid().optional(),
  })
  .strict();

export type ConsumeHandoffRequest = z.infer<typeof consumeHandoffRequestSchema>;

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('article'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('social-post'), id: z.string().min(1).max(200) }).strict(),
  z
    .object({
      kind: z.literal('creation-draft'),
      id: z.string().min(1).max(200),
      outputTarget: z
        .object({
          seriesId: z.string().min(1).max(200),
          promptVersionId: z.string().min(1).max(200),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

export const mediaSchema = z
  .object({
    mediaId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const outputImageSchema = z
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

const authenticatedRequestFields = {
  protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
  handoffId: z.string().uuid(),
  completionToken: z.string().uuid(),
} as const;

export const browserCompanionErrorCodeSchema = z.enum([
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
]);

export const browserCompanionRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      kind: z.literal('claim-handoff'),
      handoffId: z.string().uuid(),
      target: companionSiteSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      kind: z.literal('claim-latest'),
      target: companionSiteSchema,
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
      image: outputImageSchema,
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
    target: companionSiteSchema,
    request: z.union([browserCompanionRequestSchema, browserCompanionMediaRequestSchema]),
  })
  .strict();

export const browserCompanionConnectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
    port: z.literal(BROWSER_COMPANION_LOOPBACK_PORT),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export const browserCompanionBridgeParametersSchema = z
  .object({
    protocolVersion: z.coerce.number().pipe(z.literal(BROWSER_COMPANION_PROTOCOL_VERSION)),
    port: z.coerce.number().pipe(z.literal(BROWSER_COMPANION_LOOPBACK_PORT)),
    token: browserCompanionConnectionSchema.shape.token,
    target: companionSiteSchema,
    destination: z.string().url().max(4_096),
  })
  .strict();

export const browserCompanionBootstrapMessageSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal('connect-loopback'),
    connection: browserCompanionConnectionSchema,
    target: companionSiteSchema,
    destination: z.string().url().max(4_096),
  })
  .strict()
  .superRefine((value, context) => {
    if (resolveSiteFromUrl(value.destination) !== value.target) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Browser companion destination does not match its target',
      });
    }
  });

export const browserCompanionHandoffSchema = z
  .object({
    handoffId: z.string().uuid(),
    completionToken: z.string().uuid(),
    target: companionSiteSchema,
    source: sourceSchema,
    contentKind: z.enum(['social-post-body', 'prompt', 'article-body']),
    articleHtml: z.string().min(1).max(256_000).optional(),
    articleCoverMediaIndex: z.number().int().min(0).max(19).optional(),
    title: z.string().trim().min(1).max(200).nullable(),
    text: z.string().min(1).max(10_000),
    media: z.array(mediaSchema).max(20),
    createdAt: z.string().datetime({ offset: true }),
    claimedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const browserCompanionResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(BROWSER_COMPANION_PROTOCOL_VERSION),
      ok: z.literal(true),
      kind: z.literal('handoff'),
      handoff: browserCompanionHandoffSchema,
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
      code: browserCompanionErrorCodeSchema,
    })
    .strict(),
]);

const loopbackPathSchema = z.enum([BROWSER_COMPANION_REQUEST_PATH, BROWSER_COMPANION_MEDIA_PATH]);
const signatureSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const browserCompanionBridgeMessageSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(1),
      kind: z.literal('authorize-loopback-request'),
      site: companionSiteSchema,
      path: loopbackPathSchema,
      request: z.union([browserCompanionRequestSchema, browserCompanionMediaRequestSchema]),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      kind: z.literal('verify-loopback-json'),
      site: companionSiteSchema,
      requestId: z.string().uuid(),
      verificationToken: signatureSchema,
      body: z.string().max(BROWSER_COMPANION_MAX_RESPONSE_BYTES),
      signature: signatureSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      kind: z.literal('verify-loopback-media'),
      site: companionSiteSchema,
      requestId: z.string().uuid(),
      verificationToken: signatureSchema,
      media: mediaSchema,
      signature: signatureSchema,
    })
    .strict(),
]);

export const browserCompanionBridgeResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      protocolVersion: z.literal(1),
      ok: z.literal(true),
      kind: z.literal('authorized-loopback-request'),
      requestId: z.string().uuid(),
      body: z.string().max(64 * 1024),
      signature: signatureSchema,
      verificationToken: signatureSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      ok: z.literal(true),
      kind: z.literal('verified-loopback-json'),
      response: browserCompanionResponseSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      ok: z.literal(true),
      kind: z.literal('verified-loopback-media'),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(1),
      ok: z.literal(false),
      kind: z.literal('rejected-loopback-bridge'),
      reason: z
        .enum(['INVALID_MESSAGE', 'UNTRUSTED_SENDER', 'CONNECTION_NOT_CONFIGURED', 'VERIFICATION_FAILED'])
        .optional(),
    })
    .strict(),
]);

export const consumeHandoffErrorCodeSchema = z.union([
  fillDraftErrorCodeSchema,
  browserCompanionErrorCodeSchema,
  z.enum(['DESKTOP_CONNECTION_FAILED', 'MEDIA_DOWNLOAD_FAILED']),
]);

export type ConsumeHandoffErrorCode = z.infer<typeof consumeHandoffErrorCodeSchema>;

export const consumeHandoffResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      requestId: z.string().uuid(),
      site: companionSiteSchema,
      characterCount: z.number().int().nonnegative(),
      mediaCount: z.number().int().nonnegative(),
      completion: z.enum(['completed', 'failed']),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      requestId: z.string().uuid().nullable(),
      site: companionSiteSchema.nullable(),
      code: consumeHandoffErrorCodeSchema,
    })
    .strict(),
]);

export type ConsumeHandoffResponse = z.infer<typeof consumeHandoffResponseSchema>;
export type BrowserCompanionRequest = z.infer<typeof browserCompanionRequestSchema>;
export type BrowserCompanionMediaRequest = z.infer<typeof browserCompanionMediaRequestSchema>;
export type BrowserCompanionResponse = z.infer<typeof browserCompanionResponseSchema>;
export type BrowserCompanionHandoff = z.infer<typeof browserCompanionHandoffSchema>;
export type BrowserCompanionMedia = z.infer<typeof mediaSchema>;
export type BrowserCompanionOutputImage = z.infer<typeof outputImageSchema>;
export type BrowserCompanionConnection = z.infer<typeof browserCompanionConnectionSchema>;

export function handoffIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (
      z
        .string()
        .uuid()
        .safeParse(new URLSearchParams(url.hash.slice(1)).get('aiy-handoff')).data ?? null
    );
  } catch {
    return null;
  }
}

export function removeHandoffIdFromUrl(value: string): string {
  const url = new URL(value);
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete('aiy-handoff');
  fragment.delete('aiy-content');
  url.hash = fragment.toString();
  return url.toString();
}

export function resolveSiteFromUrl(value: string | undefined): CompanionSite | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'chatgpt.com') return 'chatgpt';
    if (url.hostname === 'mp.weixin.qq.com') return 'wechat';
    if (url.origin === 'https://creator.xiaohongshu.com') return 'xiaohongshu';
    if (url.origin === 'https://x.com' || url.origin === 'https://twitter.com') return 'x';
    if (url.hostname === 'weibo.com' || url.hostname === 'www.weibo.com') return 'weibo';
    return null;
  } catch {
    return null;
  }
}

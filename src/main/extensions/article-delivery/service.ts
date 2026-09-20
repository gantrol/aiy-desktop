import { selectedWatermarkProfile, type NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { naturalWatermarkProfileSchema, type NaturalWatermarkProfile } from '@/shared/contracts/natural-watermark';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import {
  normalizedArticleMediaPath,
  referencedArticleMediaBindings,
  rewriteArticleImageReferences,
} from '@/main/creations/article-media-references';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { prepareUploadImage } from '@/main/media/upload-image';
import { inspectUploadImage } from '@/shared/upload-image-policy';
import { rasterizeSvgBytesInSandbox } from '@/main/media/svg-rasterization';
import { readSvgRasterCacheBytes } from '@/main/media/svg-raster-cache';
import {
  ArticleDeliveryConnection,
  readArticleDeliveryJsonResponse,
} from '@/main/extensions/article-delivery/connection';
import {
  assertArticleDeliveryExtensionActivated,
  type ArticleDeliveryDefinition,
} from '@/main/extensions/article-delivery/definition';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import {
  articleDeliveryArticleProfileSaveInputSchema,
  articleDeliveryMode,
  articleDeliveryArticleTargetSchema,
  articleDeliveryStatusSchema,
  articleDeliveryUploadInputSchema,
  articleDeliveryUploadResultSchema,
  type ArticleDeliveryArticleProfileSaveInput,
  type ArticleDeliveryArticleTarget,
  type ArticleDeliveryUploadInput,
  type ArticleDeliveryProgress,
  type ArticleDeliveryImagePreparation,
} from '@/shared/contracts/article-delivery';
import { networkOriginExtensionPermission } from '@/shared/extension-permissions';

const MAX_ARTICLE_MARKDOWN_BYTES = 512_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const imagePreparationErrors: Readonly<Record<string, string>> = {
  UPLOAD_IMAGE_BYTES_EXCEEDED: 'DELIVERY_MEDIA_TOO_LARGE',
  UPLOAD_IMAGE_FORMAT_UNSUPPORTED: 'DELIVERY_MEDIA_UNSUPPORTED',
  UPLOAD_IMAGE_INVALID: 'DELIVERY_MEDIA_INVALID',
  UPLOAD_IMAGE_DIMENSIONS_EXCEEDED: 'DELIVERY_MEDIA_DIMENSIONS_EXCEEDED',
  UPLOAD_IMAGE_DECODER_PIXELS_EXCEEDED: 'DELIVERY_MEDIA_DECODER_LIMIT',
};
const deliveryTargetSnapshotSchema = articleDeliveryArticleProfileSaveInputSchema.pick({
  slug: true,
  description: true,
});

const apiErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();

const mediaEnvelopeSchema = z.union([
  z
    .object({
      data: z
        .object({
          key: z.string().min(1).max(512),
          url: z.string().startsWith('/media/').max(1_000),
          checksum: z.string().regex(/^[0-9a-f]{64}$/u),
          contentType: z.string().startsWith('image/'),
          size: z.number().int().positive().max(MAX_IMAGE_BYTES),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          uploadedAt: z.string().datetime({ offset: true }),
          reused: z.boolean(),
        })
        .strict(),
      meta: z.object({ version: z.string(), updatedAt: z.string() }).passthrough(),
    })
    .strict(),
  apiErrorSchema,
]);

const documentEnvelopeSchema = z.union([
  z
    .object({
      data: z
        .object({
          documentId: z.string().min(1).max(200),
          revisionId: z.string().min(1).max(200),
          version: z.number().int().positive(),
          canonicalPath: z.string().startsWith('/').max(240),
          adminUrl: z.string().url(),
          publicUrl: z.string().url(),
          unchanged: z.boolean(),
          replayed: z.boolean(),
          mode: z.enum(['draft', 'publish']).optional(),
        })
        .strict(),
      meta: z.object({ version: z.string(), updatedAt: z.string() }).passthrough(),
    })
    .strict(),
  apiErrorSchema,
]);

type CapturedMedia = {
  readonly assetId: string;
  readonly file: ResolvedAssetFile;
  readonly paths: readonly string[];
};

type MutableCapturedMedia = {
  assetId: string;
  file: ResolvedAssetFile;
  paths: string[];
};

type UploadedMedia = CapturedMedia & {
  checksum: string;
  key: string;
  url: string;
  reused: boolean;
  sourceBytes: number;
  uploadBytes: number;
  processed: boolean;
};

type RemoteMedia = { key: string; url: string; reused: boolean };

function apiData<T>(envelope: { data: T } | { error: { code: string; message: string } }, status: number): T {
  if ('error' in envelope) {
    throw Object.assign(new Error(envelope.error.message), { code: envelope.error.code, status });
  }
  if (status < 200 || status >= 300) throw new Error(`Delivery request failed (${status})`);
  return envelope.data;
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  limit: number,
  operation: (value: Input, signal: AbortSignal) => Promise<Output>,
  parentSignal?: AbortSignal,
) {
  const output = new Array<Output>(values.length);
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length && !signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        output[index] = await operation(values[index]!, signal);
      } catch (reason) {
        controller.abort(reason);
        throw reason;
      }
    }
  });
  // Drain cancelled siblings before another queued article may start uploading.
  await Promise.allSettled(workers);
  signal.throwIfAborted();
  return output;
}

function requestHeaders(token: string) {
  return { accept: 'application/json', authorization: `Bearer ${token}` };
}

function uploadWatermarkProfile(profile: NaturalWatermarkProfile, sourceChecksum: string): NaturalWatermarkProfile {
  const frozen = naturalWatermarkProfileSchema.parse(profile);
  if (!frozen.positionJitter.enabled) return frozen;
  const seed = createHash('sha256')
    .update('aiy-upload-watermark-v1\0')
    .update(sourceChecksum)
    .update('\0')
    .update(JSON.stringify(frozen))
    .digest();
  const coordinate = (axis: 'x' | 'y', offset: number) => {
    const minimum = Math.max(0, frozen.position[axis] - frozen.positionJitter[axis]);
    const maximum = Math.min(1, frozen.position[axis] + frozen.positionJitter[axis]);
    return minimum + (seed.readUIntBE(offset, 6) / 0xffffffffffff) * (maximum - minimum);
  };
  return {
    ...frozen,
    position: { x: coordinate('x', 0), y: coordinate('y', 6) },
    positionJitter: { ...frozen.positionJitter, enabled: false },
  };
}

export class ArticleDeliveryService {
  constructor(
    private readonly database: Pick<
      LibraryDatabase,
      'libraryRoot' | 'getArticle' | 'getArticleRevision' | 'resolveAssetFilesAsync' | 'contentLibrary'
    >,
    private readonly extensions: Pick<ExtensionRegistry, 'get' | 'isActivated' | 'isPermissionGranted'>,
    private readonly connection: ArticleDeliveryConnection,
    private readonly definition: ArticleDeliveryDefinition,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly naturalWatermark?: NaturalWatermarkRuntime,
  ) {}

  status(rawInput: ArticleDeliveryArticleTarget) {
    const input = articleDeliveryArticleTargetSchema.parse(rawInput);
    return articleDeliveryStatusSchema.parse({
      connection: this.connection.status(this.definition),
      profile: this.connection.articleProfile(input),
    });
  }

  saveProfile(rawInput: ArticleDeliveryArticleProfileSaveInput) {
    return this.connection.saveArticleProfile(
      this.definition,
      articleDeliveryArticleProfileSaveInputSchema.parse(rawInput),
    );
  }

  async upload(rawInput: ArticleDeliveryUploadInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    const current = this.database.getArticle(input.articleId);
    if (current.revisionId !== input.expectedRevisionId) throw new Error('Article revision changed before delivery');
    return this.uploadRevision(input, undefined, current.contentHash, undefined, undefined, signal);
  }

  async uploadRevision(
    rawInput: ArticleDeliveryUploadInput,
    rawTarget?: Readonly<{ slug: string; description: string }>,
    expectedContentHash?: string,
    onProgress?: (progress: ArticleDeliveryProgress) => void,
    capturedWatermarkProfile?: NaturalWatermarkProfile | null,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    this.assertAvailable();
    const deliveryMode = articleDeliveryMode(this.definition.configuration);
    if (input.expectedDeliveryMode && input.expectedDeliveryMode !== deliveryMode) {
      throw Object.assign(new Error('DELIVERY_MODE_CHANGED'), { code: 'DELIVERY_MODE_CHANGED' });
    }
    const configuration = this.connection.configuration(this.definition);
    const originPermission = networkOriginExtensionPermission(configuration.siteUrl);
    if (!this.extensions.isPermissionGranted(this.definition.extensionId, originPermission)) {
      throw new Error(`Delivery endpoint requires permission ${originPermission}`);
    }
    const profile = this.uploadProfile(input, rawTarget);
    await this.connection.verifySupport(
      configuration,
      deliveryMode,
      () => this.assertRequestAccess(configuration),
      signal,
    );
    signal?.throwIfAborted();

    const article = this.database.getArticleRevision({
      articleId: input.articleId,
      revisionId: input.expectedRevisionId,
    });
    if (expectedContentHash && article.contentHash !== expectedContentHash) {
      throw new Error('Article revision content changed before delivery');
    }
    article.content = this.database.contentLibrary.expandArticle(article.content);
    if (article.content.title.trim().length > 120) throw new Error('Article title exceeds 120 characters');
    if (Buffer.byteLength(article.content.markdown, 'utf8') > MAX_ARTICLE_MARKDOWN_BYTES) {
      throw new Error('Article Markdown exceeds 512 KB');
    }
    const bindings = referencedArticleMediaBindings(
      article.content.markdown,
      article.content.mediaBindings,
      article.content.coverAssetId,
    );
    const totalMedia = new Set(bindings.map((binding) => binding.assetId)).size;
    if (totalMedia > 100) throw new Error('An article can contain at most 100 images for delivery');
    onProgress?.({ phase: 'PREPARING', completedMedia: 0, totalMedia });
    const capturedMedia = await this.captureMedia(bindings);
    signal?.throwIfAborted();
    const watermarkProfile =
      capturedWatermarkProfile === undefined
        ? await selectedWatermarkProfile(input.watermark, this.naturalWatermark)
        : capturedWatermarkProfile;
    signal?.throwIfAborted();
    this.assertWatermarkAvailable(watermarkProfile);
    const source = Object.freeze({
      spaceId: input.spaceId,
      articleId: article.articleId,
      revisionId: article.revisionId,
      contentHash: article.contentHash,
      title: article.content.title,
      markdown: article.content.markdown,
      coverAssetId: article.content.coverAssetId,
      profile,
      media: capturedMedia,
    });

    let completedMedia = 0;
    const uploadedByChecksum = new Map<string, Promise<RemoteMedia>>();
    onProgress?.({ phase: 'UPLOADING_MEDIA', completedMedia, totalMedia });
    // Two bounded 25 MB sources at a time, including SVG conversion and upload.
    const uploaded = await mapConcurrent(
      source.media,
      2,
      async (item, signal) => {
        const result = await this.uploadMedia(
          configuration,
          item,
          signal,
          watermarkProfile,
          input.imagePreparation ?? { version: 1, mode: 'BALANCED' },
          uploadedByChecksum,
        );
        completedMedia += 1;
        onProgress?.({ phase: 'UPLOADING_MEDIA', completedMedia, totalMedia });
        return result;
      },
      signal,
    );
    const destinationsByPath = new Map<string, string>();
    const destinationsByAssetId = new Map<string, string>();
    for (const item of uploaded) {
      destinationsByAssetId.set(item.assetId, item.url);
      for (const mediaPath of item.paths) destinationsByPath.set(normalizedArticleMediaPath(mediaPath), item.url);
    }
    const markdown = rewriteArticleImageReferences(source.markdown, destinationsByPath, destinationsByAssetId);
    const body = JSON.stringify({
      protocolVersion: 1,
      ...(deliveryMode === 'DRAFT' ? { mode: 'draft' } : {}),
      source: {
        spaceId: source.spaceId,
        articleId: source.articleId,
        revisionId: source.revisionId,
        contentHash: source.contentHash,
      },
      target: { slug: source.profile.slug, description: source.profile.description },
      title: source.title,
      markdown,
      coverAssetId: source.coverAssetId,
      media: uploaded.map((item) => ({ assetId: item.assetId, key: item.key, checksum: item.checksum })),
    });
    const idempotencyKey = createHash('sha256').update('aiy-article-import-v1\0').update(body).digest('hex');
    onProgress?.({ phase: 'PUBLISHING', completedMedia, totalMedia });
    this.assertWatermarkAvailable(watermarkProfile);
    this.assertRequestAccess(configuration);
    signal?.throwIfAborted();
    const response = await this.fetchImpl(`${configuration.siteUrl}/api/integrations/aiy/documents`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...requestHeaders(configuration.token),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const parsedDocumentEnvelope = documentEnvelopeSchema.safeParse(await readArticleDeliveryJsonResponse(response));
    if (!parsedDocumentEnvelope.success) {
      throw Object.assign(new Error('DELIVERY_RESPONSE_INVALID'), { code: 'DELIVERY_RESPONSE_INVALID' });
    }
    const document = apiData(parsedDocumentEnvelope.data, response.status);
    if (
      (deliveryMode === 'DRAFT' ? document.mode !== 'draft' : document.mode === 'draft') ||
      document.canonicalPath !== `${this.definition.configuration.pathPrefix}${source.profile.slug}` ||
      new URL(document.adminUrl).origin !== new URL(configuration.siteUrl).origin ||
      new URL(document.publicUrl).origin !== new URL(configuration.siteUrl).origin
    ) {
      throw Object.assign(new Error('DELIVERY_RESPONSE_INVALID'), { code: 'DELIVERY_RESPONSE_INVALID' });
    }
    return articleDeliveryUploadResultSchema.parse({
      documentId: document.documentId,
      revisionId: document.revisionId,
      version: document.version,
      canonicalPath: document.canonicalPath,
      adminUrl: document.adminUrl,
      publicUrl: document.publicUrl,
      unchanged: document.unchanged,
      replayed: document.replayed,
      deliveryMode,
      uploadedMedia: uploaded.filter((item) => !item.reused).length,
      reusedMedia: uploaded.filter((item) => item.reused).length,
      imageSummary: {
        sourceBytes: uploaded.reduce((sum, item) => sum + item.sourceBytes, 0),
        uploadBytes: uploaded.reduce((sum, item) => sum + item.uploadBytes, 0),
        processedMedia: uploaded.filter((item) => item.processed).length,
        preservedMedia: uploaded.filter((item) => !item.processed).length,
      },
    });
  }

  private uploadProfile(
    input: ArticleDeliveryUploadInput,
    rawTarget: Readonly<{ slug: string; description: string }> | undefined,
  ) {
    const profile = rawTarget ? deliveryTargetSnapshotSchema.parse(rawTarget) : this.connection.articleProfile(input);
    if (!profile) throw new Error('Article delivery target is not configured');
    if (
      input.expectedProfile &&
      (input.expectedProfile.slug !== profile.slug || input.expectedProfile.description !== profile.description)
    ) {
      throw Object.assign(new Error('DELIVERY_PROFILE_CHANGED'), { code: 'DELIVERY_PROFILE_CHANGED' });
    }
    return profile;
  }

  private assertAvailable() {
    assertArticleDeliveryExtensionActivated(this.extensions, this.definition.extensionId);
    if (!this.extensions.isPermissionGranted(this.definition.extensionId, this.definition.credentialPermission)) {
      throw new Error('Article delivery credential permission is missing');
    }
    if (this.connection.status(this.definition).state !== 'READY') throw new Error('Delivery connection is not ready');
  }

  private assertWatermarkAvailable(profile: NaturalWatermarkProfile | null) {
    if (profile && !this.naturalWatermark?.isActivated()) {
      throw Object.assign(new Error('Natural Watermark is disabled or missing permissions'), {
        code: 'DELIVERY_WATERMARK_UNAVAILABLE',
      });
    }
  }

  private assertRequestAccess(configuration: Readonly<{ siteUrl: string; token: string }>) {
    this.assertAvailable();
    const currentDefinition = this.extensions.get(this.definition.extensionId)?.manifest.configuration;
    if (
      currentDefinition?.kind !== 'ARTICLE_DELIVERY' ||
      articleDeliveryMode(currentDefinition) !== articleDeliveryMode(this.definition.configuration)
    ) {
      throw Object.assign(new Error('DELIVERY_MODE_CHANGED'), { code: 'DELIVERY_MODE_CHANGED' });
    }
    if (
      !this.extensions.isPermissionGranted(
        this.definition.extensionId,
        networkOriginExtensionPermission(configuration.siteUrl),
      )
    ) {
      throw new Error('Delivery endpoint permission was revoked');
    }
    const current = this.connection.configuration(this.definition);
    if (current.siteUrl !== configuration.siteUrl || current.token !== configuration.token) {
      throw new Error('Delivery connection changed; inspect the result before retrying');
    }
  }

  private async captureMedia(bindings: readonly { path: string; assetId: string }[]) {
    const byAssetId = new Map<string, MutableCapturedMedia>();
    const files = await this.database.resolveAssetFilesAsync(bindings.map((binding) => binding.assetId));
    for (const binding of bindings) {
      const existing = byAssetId.get(binding.assetId);
      if (existing) {
        existing.paths.push(binding.path);
        continue;
      }
      const file = files.get(binding.assetId);
      if (!file) throw Object.assign(new Error(binding.path), { code: 'DELIVERY_MEDIA_UNAVAILABLE' });
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.mimeType)) {
        throw Object.assign(new Error(`${binding.path} (${file.mimeType})`), { code: 'DELIVERY_MEDIA_UNSUPPORTED' });
      }
      if (file.byteSize < 1 || file.byteSize > MAX_IMAGE_BYTES) {
        throw Object.assign(new Error(binding.path), { code: 'DELIVERY_MEDIA_TOO_LARGE' });
      }
      byAssetId.set(binding.assetId, { assetId: binding.assetId, file: { ...file }, paths: [binding.path] });
    }
    return [...byAssetId.values()].map((item) => Object.freeze({ ...item, paths: Object.freeze([...item.paths]) }));
  }

  private async uploadMedia(
    configuration: Readonly<{ siteUrl: string; token: string }>,
    item: CapturedMedia,
    signal: AbortSignal,
    watermarkProfile: NaturalWatermarkProfile | null,
    imagePreparation: ArticleDeliveryImagePreparation,
    uploadedByChecksum: Map<string, Promise<RemoteMedia>>,
  ): Promise<UploadedMedia> {
    signal.throwIfAborted();
    this.assertRequestAccess(configuration);
    let bytes: Buffer;
    try {
      bytes = await readBoundedImageFile(item.file.absolutePath, signal, MAX_IMAGE_BYTES);
    } catch (reason) {
      signal.throwIfAborted();
      throw Object.assign(new Error(item.paths[0], { cause: reason }), { code: 'DELIVERY_MEDIA_UNAVAILABLE' });
    }
    const sourceChecksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== item.file.byteSize || sourceChecksum !== item.file.objectHash) {
      throw Object.assign(new Error(item.paths[0]), { code: 'DELIVERY_MEDIA_CHANGED' });
    }
    let mimeType = item.file.mimeType;
    let fileName = item.file.suggestedName;
    if (mimeType === 'image/svg+xml') {
      try {
        bytes =
          (await readSvgRasterCacheBytes(this.database.libraryRoot, item.file.objectHash, signal)) ??
          (await rasterizeSvgBytesInSandbox(bytes, signal)).bytes;
      } catch (reason) {
        signal.throwIfAborted();
        throw Object.assign(new Error(item.paths[0], { cause: reason }), { code: 'DELIVERY_MEDIA_CONVERSION_FAILED' });
      }
      mimeType = 'image/png';
      fileName = fileName.replace(/\.svg$/iu, '.png');
    }
    try {
      const source = inspectUploadImage(bytes, mimeType);
      if (watermarkProfile && source.animated && source.mimeType !== 'image/gif') {
        throw Object.assign(new Error(item.paths[0]), {
          code: 'DELIVERY_MEDIA_WATERMARK_ANIMATION_UNSUPPORTED',
        });
      }
      const output = await prepareUploadImage(bytes, mimeType, { mode: imagePreparation.mode, signal });
      bytes = output.bytes;
      mimeType = output.mimeType;
      if (watermarkProfile) {
        this.assertWatermarkAvailable(watermarkProfile);
        const watermarked = await this.naturalWatermark!.service.applyBytes(
          bytes,
          mimeType,
          fileName,
          uploadWatermarkProfile(watermarkProfile, sourceChecksum),
          signal,
        );
        this.assertWatermarkAvailable(watermarkProfile);
        bytes = watermarked.bytes;
        mimeType = watermarked.mimeType;
        fileName = watermarked.suggestedName;
      }
    } catch (reason) {
      signal.throwIfAborted();
      const code =
        reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string'
          ? reason.code
          : (imagePreparationErrors[reason instanceof Error ? reason.message : ''] ??
            'DELIVERY_MEDIA_PREPARATION_FAILED');
      throw Object.assign(new Error(item.paths[0], { cause: reason }), { code });
    }
    signal.throwIfAborted();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error(item.paths[0]), { code: 'DELIVERY_MEDIA_TOO_LARGE' });
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const prepared = {
      ...item,
      checksum,
      sourceBytes: item.file.byteSize,
      uploadBytes: bytes.byteLength,
      processed: checksum !== sourceChecksum,
    };
    const existing = uploadedByChecksum.get(checksum);
    if (existing) return { ...prepared, ...(await existing), reused: true };
    this.assertWatermarkAvailable(watermarkProfile);
    const upload = this.sendMedia(configuration, bytes, mimeType, fileName, checksum, signal);
    uploadedByChecksum.set(checksum, upload);
    return { ...prepared, ...(await upload) };
  }

  private async sendMedia(
    configuration: Readonly<{ siteUrl: string; token: string }>,
    bytes: Buffer,
    mimeType: string,
    fileName: string,
    checksum: string,
    signal: AbortSignal,
  ): Promise<RemoteMedia> {
    signal.throwIfAborted();
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), fileName);
    this.assertRequestAccess(configuration);
    const response = await this.fetchImpl(`${configuration.siteUrl}/api/integrations/aiy/media`, {
      method: 'POST',
      redirect: 'error',
      headers: { ...requestHeaders(configuration.token), 'x-aiy-content-sha256': checksum },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    const parsedMediaEnvelope = mediaEnvelopeSchema.safeParse(await readArticleDeliveryJsonResponse(response));
    if (!parsedMediaEnvelope.success) {
      throw new Error(`Delivery media endpoint returned an incompatible response (${response.status})`);
    }
    const media = apiData(parsedMediaEnvelope.data, response.status);
    if (media.checksum !== checksum || media.contentType !== mimeType || media.size !== bytes.byteLength) {
      throw Object.assign(new Error('DELIVERY_RESPONSE_INVALID'), { code: 'DELIVERY_RESPONSE_INVALID' });
    }
    const mediaUrl = new URL(media.url, configuration.siteUrl);
    if (mediaUrl.origin !== new URL(configuration.siteUrl).origin || !mediaUrl.pathname.startsWith('/media/')) {
      throw Object.assign(new Error('DELIVERY_RESPONSE_INVALID'), { code: 'DELIVERY_RESPONSE_INVALID' });
    }
    return { key: media.key, url: media.url, reused: media.reused };
  }
}

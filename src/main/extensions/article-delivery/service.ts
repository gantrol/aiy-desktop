import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { normalizedArticleMediaPath, rewriteArticleImageReferences } from '@/main/creations/article-media-references';
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
  articleDeliveryArticleTargetSchema,
  articleDeliveryStatusSchema,
  articleDeliveryUploadInputSchema,
  articleDeliveryUploadResultSchema,
  type ArticleDeliveryArticleProfileSaveInput,
  type ArticleDeliveryArticleTarget,
  type ArticleDeliveryUploadInput,
} from '@/shared/contracts/article-delivery';
import { networkOriginExtensionPermission } from '@/shared/extension-permissions';

const MAX_ARTICLE_MARKDOWN_BYTES = 512_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
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
};

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
  operation: (value: Input) => Promise<Output>,
) {
  const output = new Array<Output>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

function requestHeaders(token: string) {
  return { accept: 'application/json', authorization: `Bearer ${token}` };
}

export class ArticleDeliveryService {
  constructor(
    private readonly database: Pick<LibraryDatabase, 'getArticle' | 'getArticleRevision' | 'resolveAssetFile'>,
    private readonly extensions: Pick<ExtensionRegistry, 'get' | 'isActivated' | 'isPermissionGranted'>,
    private readonly connection: ArticleDeliveryConnection,
    private readonly definition: ArticleDeliveryDefinition,
    private readonly fetchImpl: typeof fetch = fetch,
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

  async upload(rawInput: ArticleDeliveryUploadInput) {
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    const current = this.database.getArticle(input.articleId);
    if (current.revisionId !== input.expectedRevisionId) throw new Error('Article revision changed before delivery');
    return this.uploadRevision(input, undefined, current.contentHash);
  }

  async uploadRevision(
    rawInput: ArticleDeliveryUploadInput,
    rawTarget?: Readonly<{ slug: string; description: string }>,
    expectedContentHash?: string,
  ) {
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    this.assertAvailable();
    const configuration = this.connection.configuration(this.definition);
    const originPermission = networkOriginExtensionPermission(configuration.siteUrl);
    if (!this.extensions.isPermissionGranted(this.definition.extensionId, originPermission)) {
      throw new Error(`Delivery endpoint requires permission ${originPermission}`);
    }
    const profile = rawTarget ? deliveryTargetSnapshotSchema.parse(rawTarget) : this.connection.articleProfile(input);
    if (!profile) throw new Error('Article delivery target is not configured');

    const article = this.database.getArticleRevision({
      articleId: input.articleId,
      revisionId: input.expectedRevisionId,
    });
    if (expectedContentHash && article.contentHash !== expectedContentHash) {
      throw new Error('Article revision content changed before delivery');
    }
    if (article.content.title.trim().length > 120) throw new Error('Article title exceeds 120 characters');
    if (Buffer.byteLength(article.content.markdown, 'utf8') > MAX_ARTICLE_MARKDOWN_BYTES) {
      throw new Error('Article Markdown exceeds 512 KB');
    }
    const capturedMedia = this.captureMedia(article.content.mediaBindings);
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

    const uploaded = await mapConcurrent(source.media, 3, (item) => this.uploadMedia(configuration, item));
    const destinationsByPath = new Map<string, string>();
    const destinationsByAssetId = new Map<string, string>();
    for (const item of uploaded) {
      destinationsByAssetId.set(item.assetId, item.url);
      for (const mediaPath of item.paths) destinationsByPath.set(normalizedArticleMediaPath(mediaPath), item.url);
    }
    const markdown = rewriteArticleImageReferences(source.markdown, destinationsByPath, destinationsByAssetId);
    const body = JSON.stringify({
      protocolVersion: 1,
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
    const response = await this.fetchImpl(`${configuration.siteUrl}/api/integrations/aiy/documents`, {
      method: 'POST',
      headers: {
        ...requestHeaders(configuration.token),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const parsedDocumentEnvelope = documentEnvelopeSchema.safeParse(await readArticleDeliveryJsonResponse(response));
    if (!parsedDocumentEnvelope.success) {
      throw new Error(`Delivery document endpoint returned an incompatible response (${response.status})`);
    }
    const document = apiData(parsedDocumentEnvelope.data, response.status);
    if (!document.canonicalPath.startsWith(this.definition.configuration.pathPrefix)) {
      throw new Error('Delivery endpoint returned an invalid article path');
    }
    return articleDeliveryUploadResultSchema.parse({
      ...document,
      uploadedMedia: uploaded.filter((item) => !item.reused).length,
      reusedMedia: uploaded.filter((item) => item.reused).length,
    });
  }

  private assertAvailable() {
    assertArticleDeliveryExtensionActivated(this.extensions, this.definition.extensionId);
    if (!this.extensions.isPermissionGranted(this.definition.extensionId, this.definition.credentialPermission)) {
      throw new Error('Article delivery credential permission is missing');
    }
    if (this.connection.status(this.definition).state !== 'READY') throw new Error('Delivery connection is not ready');
  }

  private captureMedia(bindings: readonly { path: string; assetId: string }[]) {
    const byAssetId = new Map<string, MutableCapturedMedia>();
    for (const binding of bindings) {
      const existing = byAssetId.get(binding.assetId);
      if (existing) {
        existing.paths.push(binding.path);
        continue;
      }
      const file = this.database.resolveAssetFile(binding.assetId);
      if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType)) {
        throw new Error('An article image is unavailable for delivery');
      }
      if (file.byteSize < 1 || file.byteSize > MAX_IMAGE_BYTES) throw new Error('An article image exceeds 25 MB');
      byAssetId.set(binding.assetId, { assetId: binding.assetId, file: { ...file }, paths: [binding.path] });
    }
    return [...byAssetId.values()].map((item) => Object.freeze({ ...item, paths: Object.freeze([...item.paths]) }));
  }

  private async uploadMedia(
    configuration: Readonly<{ siteUrl: string; token: string }>,
    item: CapturedMedia,
  ): Promise<UploadedMedia> {
    const bytes = await readFile(item.file.absolutePath);
    if (bytes.byteLength !== item.file.byteSize || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('An article image changed before delivery');
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: item.file.mimeType }), item.file.suggestedName);
    const response = await this.fetchImpl(`${configuration.siteUrl}/api/integrations/aiy/media`, {
      method: 'POST',
      headers: { ...requestHeaders(configuration.token), 'x-aiy-content-sha256': checksum },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const parsedMediaEnvelope = mediaEnvelopeSchema.safeParse(await readArticleDeliveryJsonResponse(response));
    if (!parsedMediaEnvelope.success) {
      throw new Error(`Delivery media endpoint returned an incompatible response (${response.status})`);
    }
    const media = apiData(parsedMediaEnvelope.data, response.status);
    if (media.checksum !== checksum) throw new Error('Delivery endpoint returned a mismatched image checksum');
    return { ...item, checksum, key: media.key, url: media.url, reused: media.reused };
  }
}

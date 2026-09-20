import { articleWechatMessages } from '@/shared/i18n/article-wechat';
import { selectedWatermarkProfile, type NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import type { ArticleCopyForWechatInput, ArticleCopyForWechatResult, ArticleDto } from '@/shared/contracts';
import { articleWechatInteractionProjection } from '@/shared/article-wechat-interactions';
import {
  articleWechatImageReferences,
  normalizeArticleWechatMediaPath,
  renderArticleForWechatDocument,
  type ArticleWechatImageSource,
} from '@/shared/article-wechat-renderer';

const MAX_WECHAT_CLIPBOARD_MEDIA_BYTES = 96 * 1024 * 1024;
const MAX_WECHAT_CLIPBOARD_HTML_BYTES = 132 * 1024 * 1024;

interface ArticleWechatCopyDatabase {
  getArticle(id: string): ArticleDto;
  resolveAssetFilesAsync(assetIds: readonly string[]): Promise<ReadonlyMap<string, ResolvedAssetFile>>;
  contentLibrary: Pick<
    import('@/main/database/creations/content-library-repository').ContentLibraryRepository,
    'expandArticle' | 'render'
  >;
}

export interface ArticleWechatCopyPorts {
  referenceTitle?(locale: ArticleCopyForWechatInput['locale']): string;
  writeClipboard(data: { html: string; text: string }): void;
  convertWebpBytesToPng(bytes: Buffer): Promise<Buffer | null>;
  convertSvgBytesToPng(bytes: Buffer): Promise<Buffer | null>;
}

function referencedArticleImages(article: ArticleDto) {
  const references = articleWechatImageReferences(article.content.markdown);
  const bindingsByPath = new Map(
    article.content.mediaBindings.map((binding) => [normalizeArticleWechatMediaPath(binding.path), binding]),
  );
  const localImages = references.localImagePaths.map((referencedPath) => {
    const binding = bindingsByPath.get(referencedPath);
    if (!binding) throw new Error('An article image is unavailable for WeChat copy');
    return { referencedPath, binding };
  });
  return { localImages, remoteImageCount: references.remoteImageUrls.length };
}

async function preparedWechatImage(source: { bytes: Buffer; mimeType: string }, ports: ArticleWechatCopyPorts) {
  const sourceBytes = source.bytes;
  if (source.mimeType === 'image/webp' || source.mimeType === 'image/svg+xml') {
    const converted = await (source.mimeType === 'image/webp'
      ? ports.convertWebpBytesToPng(sourceBytes)
      : ports.convertSvgBytesToPng(sourceBytes));
    if (!converted) throw new Error('An article image could not be prepared for WeChat');
    return { bytes: converted, mimeType: 'image/png' as const };
  }
  if (source.mimeType === 'image/png' || source.mimeType === 'image/jpeg' || source.mimeType === 'image/gif') {
    return { bytes: sourceBytes, mimeType: source.mimeType };
  }
  throw new Error('An article image is unavailable for WeChat copy');
}

export class ArticleWechatCopyService {
  constructor(
    private readonly database: ArticleWechatCopyDatabase,
    private readonly ports: ArticleWechatCopyPorts,
    private readonly naturalWatermark?: NaturalWatermarkRuntime,
  ) {}

  async copy(input: ArticleCopyForWechatInput): Promise<ArticleCopyForWechatResult> {
    const saved = this.database.getArticle(input.id);
    const article = { ...saved, content: this.database.contentLibrary.expandArticle(saved.content) };
    const { localImages, remoteImageCount } = referencedArticleImages(article);
    const files = await this.database.resolveAssetFilesAsync(localImages.map(({ binding }) => binding.assetId));
    const resolvedImages = localImages.map(({ referencedPath, binding }) => {
      const source = files.get(binding.assetId);
      if (!source || !source.mimeType.startsWith('image/')) {
        throw new Error('An article image is unavailable for WeChat copy');
      }
      return { referencedPath, source };
    });

    const watermarkProfile = resolvedImages.length
      ? await selectedWatermarkProfile(input.watermark, this.naturalWatermark)
      : null;
    const imagesByPath = new Map<string, ArticleWechatImageSource>();
    let mediaBytes = 0;
    for (const { referencedPath, source } of resolvedImages) {
      const image =
        watermarkProfile && this.naturalWatermark
          ? await this.naturalWatermark.service.apply(source, watermarkProfile)
          : { bytes: await readBoundedImageFile(source.absolutePath), mimeType: source.mimeType };
      const prepared = await preparedWechatImage(image, this.ports);
      mediaBytes += prepared.bytes.byteLength;
      if (mediaBytes > MAX_WECHAT_CLIPBOARD_MEDIA_BYTES) {
        throw new Error('The article images are too large to copy to WeChat at once');
      }
      imagesByPath.set(referencedPath, {
        src: `data:${prepared.mimeType};base64,${prepared.bytes.toString('base64')}`,
        width: source.width,
        height: source.height,
      });
    }

    const projection = articleWechatInteractionProjection(article.content.document, article.content.mediaBindings);
    const expandedProjection = projection ? this.database.contentLibrary.render(projection.markdown).markdown : null;
    const rendered = renderArticleForWechatDocument(
      article.content.markdown,
      projection,
      expandedProjection,
      article.content.mediaBindings,
      imagesByPath,
      {
        linksAsEndReferences: input.linksAsEndReferences,
        referenceTitle: this.ports.referenceTitle?.(input.locale) ?? articleWechatMessages.referenceTitle,
      },
    );
    if (Buffer.byteLength(rendered.html, 'utf8') > MAX_WECHAT_CLIPBOARD_HTML_BYTES) {
      throw new Error('The formatted article is too large to copy to WeChat at once');
    }
    if (!rendered.text && imagesByPath.size === 0 && remoteImageCount === 0) {
      throw new Error('The article has no body to copy');
    }
    this.ports.writeClipboard({ html: rendered.html, text: rendered.text });
    return {
      embeddedImageCount: imagesByPath.size,
      remoteImageCount,
      endReferenceCount: rendered.diagnostics.endReferenceCount,
    };
  }
}

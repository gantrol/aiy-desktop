import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import type { ArticleCopyForWechatInput, ArticleCopyForWechatResult, ArticleDto } from '@/shared/contracts';
import {
  articleWechatImageReferences,
  normalizeArticleWechatMediaPath,
  renderArticleForWechat,
  type ArticleWechatImageSource,
} from '@/shared/article-wechat-renderer';

const MAX_WECHAT_CLIPBOARD_MEDIA_BYTES = 96 * 1024 * 1024;
const MAX_WECHAT_CLIPBOARD_HTML_BYTES = 132 * 1024 * 1024;

interface ArticleWechatCopyDatabase {
  getArticle(id: string): ArticleDto;
  resolveAssetFile(assetId: string): ResolvedAssetFile | null;
}

export interface ArticleWechatCopyPorts {
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

async function preparedWechatImage(source: ResolvedAssetFile, ports: ArticleWechatCopyPorts) {
  const sourceBytes = await readBoundedImageFile(source.absolutePath);
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
  ) {}

  async copy(input: ArticleCopyForWechatInput): Promise<ArticleCopyForWechatResult> {
    const article = this.database.getArticle(input.id);
    const { localImages, remoteImageCount } = referencedArticleImages(article);
    const resolvedImages = localImages.map(({ referencedPath, binding }) => {
      const source = this.database.resolveAssetFile(binding.assetId);
      if (!source || !source.mimeType.startsWith('image/')) {
        throw new Error('An article image is unavailable for WeChat copy');
      }
      return { referencedPath, source };
    });

    const imagesByPath = new Map<string, ArticleWechatImageSource>();
    let mediaBytes = 0;
    for (const { referencedPath, source } of resolvedImages) {
      const prepared = await preparedWechatImage(source, this.ports);
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

    const rendered = renderArticleForWechat(article.content.markdown, imagesByPath, {
      linksAsEndReferences: input.linksAsEndReferences,
      referenceTitle: input.locale === 'zh' ? '引用链接' : 'References',
    });
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

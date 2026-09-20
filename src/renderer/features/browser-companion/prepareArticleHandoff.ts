import { prepareImagePostHandoff } from '@/renderer/features/browser-companion/prepareImagePostHandoff';
import type { ArticleDto, BrowserCompanionSource, BrowserCompanionTarget } from '@/shared/contracts';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import {
  articleWechatInteractionProjection,
  type ArticleWechatInteractionProjection,
} from '@/shared/article-wechat-interactions';
import {
  articleWechatImageOccurrences,
  normalizeArticleWechatMediaPath,
  renderArticleForWechat,
  renderArticleForWechatDocument,
  type ArticleWechatImageSource,
} from '@/shared/article-wechat-renderer';
import { contentAssetPath } from '@/shared/content-document';
import { contentImageNumber } from '@/shared/content-image-number';
import { contentFigureReferences, contentPublishingMediaBindings } from '@/shared/content-publishing-mask';
import type { BrowserCompanionStageInput } from '@/shared/contracts';

type ExpandedArticleContent = Awaited<ReturnType<typeof window.desktopApi.contentLibrary.render>>;

export async function prepareArticleHandoff({
  article,
  target,
  copy,
  notify,
  expandedContent,
}: {
  article: ArticleDto;
  target: BrowserCompanionTarget;
  copy: DesktopPetalMessages['document'];
  notify(message: string): void;
  expandedContent?: ExpandedArticleContent;
}) {
  const content = article.content;
  const expanded = expandedContent ?? (await window.desktopApi.contentLibrary.render(content.markdown));
  return prepareImagePostHandoff({
    source: { kind: 'article', id: article.id },
    title: content.title,
    body: expanded.markdown,
    format: 'markdown',
    // Use the cover, then images in document order. Removed editor assets are not attachments.
    leadingMediaAssetIds: content.coverAssetId ? [content.coverAssetId] : [],
    mediaAssetIds: [],
    mediaBindings: [...content.mediaBindings, ...expanded.media],
    target,
    copy,
    notify,
  });
}

export interface WechatArticleHandoffCopy {
  missingImage: string;
  bodyRequired: string;
  bodyLimit: string;
  mediaLimit: string;
  titleRequired: string;
  titleLimit: string;
  htmlLimit: string;
  imageNumber?: string;
  numbering?: string;
}

interface WechatContentHandoffInput {
  markdown: string;
  document?: {
    projection: ArticleWechatInteractionProjection | null;
    expandedMarkdown: string | null;
    mediaBindings: ArticleDto['content']['mediaBindings'];
    mediaAssets: ArticleDto['content']['mediaAssets'];
  };
  source: Extract<BrowserCompanionSource, { kind: 'article' | 'social-post' }>;
  title: string;
  mediaAssetIds?: readonly string[];
  mediaBindings: readonly { path: string; assetId: string }[];
  coverAssetId?: string | null;
  referenceTitle: string;
  copy: WechatArticleHandoffCopy;
  notify(message: string): void;
}

function prepareWechatContentMedia({
  markdown,
  document,
  mediaAssetIds: attachedAssetIds = [],
  mediaBindings,
  coverAssetId,
  copy,
  notify,
}: WechatContentHandoffInput) {
  const bindings = contentPublishingMediaBindings(
    [...attachedAssetIds, ...(coverAssetId ? [coverAssetId] : [])],
    mediaBindings,
  );
  const mediaAssetIds: string[] = [];
  const placements: { path: string; assetId: string }[] = [];
  for (const imagePath of articleWechatImageOccurrences(markdown)) {
    const id = bindings.assetId(imagePath);
    if (!id) {
      notify(copy.missingImage);
      return null;
    }
    if (!mediaAssetIds.includes(id)) mediaAssetIds.push(id);
    placements.push({ path: imagePath, assetId: id });
  }
  // Social posts can contain gallery attachments with no inline placement yet.
  // Keep existing placements and append only those unplaced, selected attachments.
  const trailingImages: string[] = [];
  for (const id of attachedAssetIds) {
    if (mediaAssetIds.includes(id)) continue;
    mediaAssetIds.push(id);
    const path = contentAssetPath(id);
    placements.push({ path, assetId: id });
    trailingImages.push(`![](${path})`);
  }
  const figureReferences = contentFigureReferences(markdown);
  if (figureReferences.some(({ assetId }) => !assetId || !mediaAssetIds.includes(assetId))) {
    notify(copy.missingImage);
    return null;
  }
  const referencedIds = new Set(figureReferences.map(({ assetId }) => assetId!));
  const numbering = copy.numbering ?? 'decimal';
  const figureLabels = new Map(
    mediaAssetIds.map((id, index) => [
      id,
      (copy.imageNumber ?? 'Image {number}').replace('{number}', contentImageNumber(index + 1, numbering)),
    ]),
  );
  const images = new Map<string, ArticleWechatImageSource>();
  const assetsById = new Map(document?.mediaAssets.map((asset) => [asset.id, asset]));
  for (const { path, assetId } of placements) {
    const asset = assetsById.get(assetId);
    images.set(normalizeArticleWechatMediaPath(path), {
      src: `aiy-handoff-media:${mediaAssetIds.indexOf(assetId)}`,
      width: asset?.width ?? 0,
      height: asset?.height ?? 0,
      ...(referencedIds.has(assetId) ? { caption: figureLabels.get(assetId) } : {}),
    });
  }
  if (coverAssetId && !mediaAssetIds.includes(coverAssetId)) mediaAssetIds.push(coverAssetId);
  if (mediaAssetIds.length > 20) {
    notify(copy.mediaLimit.replace('{count}', '20'));
    return null;
  }
  return { mediaAssetIds, images, figureLabels, trailingImages };
}

export function prepareWechatContentHandoff({
  markdown,
  document,
  source,
  title: requestedTitle,
  mediaAssetIds: attachedAssetIds = [],
  mediaBindings,
  coverAssetId,
  referenceTitle,
  copy,
  notify,
}: WechatContentHandoffInput): Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null {
  const title = requestedTitle.trim();
  if (!title || title.length > 64) {
    notify(title ? copy.titleLimit : copy.titleRequired);
    return null;
  }
  const media = prepareWechatContentMedia({
    markdown,
    document,
    source,
    title: requestedTitle,
    mediaAssetIds: attachedAssetIds,
    mediaBindings,
    coverAssetId,
    referenceTitle,
    copy,
    notify,
  });
  if (!media) return null;
  const { mediaAssetIds, images, figureLabels, trailingImages } = media;
  const preparedMarkdown = [markdown, ...trailingImages].filter(Boolean).join('\n\n');
  const renderOptions = {
    linksAsEndReferences: true,
    referenceTitle,
    figureReferenceLabels: figureLabels,
  };
  const rendered = renderArticleForWechatDocument(
    preparedMarkdown,
    document?.projection ?? null,
    document?.expandedMarkdown ?? null,
    document?.mediaBindings ?? mediaBindings,
    images,
    renderOptions,
  );
  const staticHtml = rendered.html.includes('data-aiy-interaction=')
    ? renderArticleForWechat(preparedMarkdown, images, renderOptions).html
    : null;
  const articleHtml = staticHtml ? `${rendered.html}<template data-aiy-static>${staticHtml}</template>` : rendered.html;
  if (!rendered.text || rendered.text.length > 10_000 || articleHtml.length > 256_000) {
    notify(!rendered.text ? copy.bodyRequired : rendered.text.length > 10_000 ? copy.bodyLimit : copy.htmlLimit);
    return null;
  }
  return {
    source,
    contentKind: 'article-body',
    title,
    text: rendered.text,
    articleHtml,
    ...(coverAssetId ? { articleCoverMediaIndex: mediaAssetIds.indexOf(coverAssetId) } : {}),
    mediaAssetIds,
  };
}

export async function prepareWechatArticleHandoff({
  article,
  referenceTitle,
  copy,
  notify,
  expandedContent,
}: {
  article: ArticleDto;
  referenceTitle: string;
  copy: WechatArticleHandoffCopy;
  notify(message: string): void;
  expandedContent?: ExpandedArticleContent;
}): Promise<Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null> {
  const expanded = expandedContent ?? (await window.desktopApi.contentLibrary.render(article.content.markdown));
  const projection = articleWechatInteractionProjection(article.content.document, article.content.mediaBindings);
  const expandedMarkdown = projection
    ? (await window.desktopApi.contentLibrary.render(projection.markdown)).markdown
    : null;
  return prepareWechatContentHandoff({
    document: {
      projection,
      expandedMarkdown,
      mediaBindings: article.content.mediaBindings,
      mediaAssets: article.content.mediaAssets,
    },
    source: { kind: 'article', id: article.id },
    title: article.content.title,
    markdown: expanded.markdown,
    mediaBindings: [...article.content.mediaBindings, ...expanded.media],
    coverAssetId: article.content.coverAssetId,
    referenceTitle,
    copy,
    notify,
  });
}

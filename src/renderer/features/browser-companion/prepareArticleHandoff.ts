import { prepareImagePostHandoff } from '@/renderer/features/browser-companion/prepareImagePostHandoff';
import type { ArticleDto, BrowserCompanionTarget } from '@/shared/contracts';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import {
  articleWechatImageReferences,
  normalizeArticleWechatMediaPath,
  renderArticleForWechat,
} from '@/shared/article-wechat-renderer';
import { contentAssetPath } from '@/shared/content-document';
import type { BrowserCompanionStageInput } from '@/shared/contracts';

export async function prepareArticleHandoff({
  article,
  target,
  copy,
  notify,
}: {
  article: ArticleDto;
  target: BrowserCompanionTarget;
  copy: DesktopPetalMessages['document'];
  notify(message: string): void;
}) {
  const content = article.content;
  const expanded = await window.desktopApi.contentLibrary.render(content.markdown);
  return prepareImagePostHandoff({
    source: { kind: 'article', id: article.id },
    title: content.title,
    body: expanded.markdown,
    format: 'markdown',
    // Use the cover, then images in document order. Removed editor assets are not attachments.
    mediaAssetIds: content.coverAssetId ? [content.coverAssetId] : [],
    mediaBindings: [...content.mediaBindings, ...expanded.media],
    target,
    copy,
    notify,
  });
}

export async function prepareWechatArticleHandoff({
  article,
  referenceTitle,
  copy,
  notify,
}: {
  article: ArticleDto;
  referenceTitle: string;
  copy: {
    missingImage: string;
    bodyRequired: string;
    bodyLimit: string;
    mediaLimit: string;
    titleRequired: string;
    titleLimit: string;
    htmlLimit: string;
  };
  notify(message: string): void;
}): Promise<Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null> {
  const title = article.content.title.trim();
  if (!title || title.length > 64) {
    notify(title ? copy.titleLimit : copy.titleRequired);
    return null;
  }
  const expanded = await window.desktopApi.contentLibrary.render(article.content.markdown);
  const bindings = new Map<string, string>();
  for (const binding of [...article.content.mediaBindings, ...expanded.media]) {
    bindings.set(normalizeArticleWechatMediaPath(binding.path), binding.assetId);
    bindings.set(contentAssetPath(binding.assetId), binding.assetId);
    bindings.set('aiy-media://asset/' + encodeURIComponent(binding.assetId), binding.assetId);
  }
  const references = articleWechatImageReferences(expanded.markdown);
  const mediaAssetIds: string[] = [];
  const images = new Map<string, { src: string; width: number; height: number }>();
  for (const imagePath of [...references.localImagePaths, ...references.remoteImageUrls]) {
    const id = bindings.get(normalizeArticleWechatMediaPath(imagePath));
    if (!id) {
      notify(copy.missingImage);
      return null;
    }
    if (!mediaAssetIds.includes(id)) mediaAssetIds.push(id);
    images.set(normalizeArticleWechatMediaPath(imagePath), {
      src: `aiy-handoff-media:${mediaAssetIds.indexOf(id)}`,
      width: 0,
      height: 0,
    });
  }
  const coverId = article.content.coverAssetId;
  if (coverId && !mediaAssetIds.includes(coverId)) mediaAssetIds.push(coverId);
  if (mediaAssetIds.length > 20) {
    notify(copy.mediaLimit.replace('{count}', '20'));
    return null;
  }
  const rendered = renderArticleForWechat(expanded.markdown, images, { linksAsEndReferences: true, referenceTitle });
  if (!rendered.text || rendered.text.length > 10_000 || rendered.html.length > 256_000) {
    notify(!rendered.text ? copy.bodyRequired : rendered.text.length > 10_000 ? copy.bodyLimit : copy.htmlLimit);
    return null;
  }
  return {
    source: { kind: 'article', id: article.id },
    contentKind: 'article-body',
    title,
    text: rendered.text,
    articleHtml: rendered.html,
    ...(coverId ? { articleCoverMediaIndex: mediaAssetIds.indexOf(coverId) } : {}),
    mediaAssetIds,
  };
}

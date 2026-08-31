import type { ArticleContentInput, AssetDto, Locale, SocialPostContentInput } from '@/shared/contracts';
import { articleMarkdownFromPlainText } from '@/renderer/components/creator/articleMarkdownFromPlainText';

function articleImageExtension(asset: AssetDto) {
  if (asset.mimeType === 'image/png') return 'png';
  if (asset.mimeType === 'image/webp') return 'webp';
  if (asset.mimeType === 'image/svg+xml') return 'svg';
  return 'jpg';
}

export function articleMediaBindings(assets: readonly AssetDto[], prefix: 'reference' | 'post') {
  return assets.map((asset, index) => ({
    path: `assets/${prefix}-${index + 1}-${asset.id}.${articleImageExtension(asset)}`,
    assetId: asset.id,
  }));
}

export function markdownWithImages(body: string, bindings: readonly { path: string }[], locale: Locale) {
  const imageMarkdown = bindings
    .map((binding, index) => `![${locale === 'zh' ? '图片' : 'Image'} ${index + 1}](${binding.path})`)
    .join('\n\n');
  return [articleMarkdownFromPlainText(body), imageMarkdown].filter(Boolean).join('\n\n');
}

export function socialPostBodyFromMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/gu, '\n')
    .replace(/!\[[^\]]*\]\([^\r\n)]*\)/gu, '')
    .trim();
}

export function emptyArticleContent(): ArticleContentInput {
  return {
    schemaVersion: 1,
    title: '',
    markdown: '',
    mediaBindings: [],
    coverAssetId: null,
  };
}

export function emptySocialPostContent(): SocialPostContentInput {
  return {
    schemaVersion: 1,
    title: '',
    body: '',
    mediaAssetIds: [],
    coverAssetId: null,
  };
}

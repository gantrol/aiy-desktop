import { contentAssetPath, plainTextMarkdown } from '@/shared/content-document';
import { contentMarkdownMediaPaths, replaceMarkdownMedia } from '@/shared/content-markdown';
import { articleContentSchema } from '@/shared/contracts/article';
import { blockDocumentAssetIds, captureBlockDocument } from '@/shared/contracts/block-document';
import { socialPostStoredContentSchema } from '@/shared/contracts/social-post';
import { derivedVisualImageExtension } from '@/shared/derived-visual-media';
import type { AssetDto } from '@/shared/contracts';

/** Import the old post format once, retaining block identities and attachment order. */
export function socialPostArticleContent(raw: unknown, assets: readonly Pick<AssetDto, 'id' | 'mimeType'>[] = []) {
  const post = socialPostStoredContentSchema.parse(raw);
  const mimeTypes = new Map(assets.map((asset) => [asset.id, asset.mimeType]));
  const mediaBindings = post.mediaAssetIds.map((assetId, index) => ({
    assetId,
    path: `assets/post-${index + 1}.${mimeTypes.get(assetId) === 'image/avif' ? 'avif' : derivedVisualImageExtension(mimeTypes.get(assetId) ?? 'image/png')}`,
  }));
  if (!post.document) {
    const markdown = post.format === 'markdown' ? post.body : plainTextMarkdown(post.body);
    const inlinePaths = contentMarkdownMediaPaths(markdown);
    return articleContentSchema.parse({
      schemaVersion: 1,
      title: post.title,
      markdown: [
        replaceMarkdownMedia(
          markdown,
          new Map(mediaBindings.map(({ assetId, path }) => [contentAssetPath(assetId), path])),
        ),
        ...mediaBindings
          .filter(({ assetId }) => !inlinePaths.has(contentAssetPath(assetId)))
          .map(({ path }) => `![](${path})`),
      ]
        .filter(Boolean)
        .join('\n\n'),
      mediaBindings,
      coverAssetId: post.coverAssetId,
    });
  }
  const body = post.document;
  const inlineIds = new Set(blockDocumentAssetIds(body));
  const document = captureBlockDocument({
    ...body.root,
    content: [
      ...(body.root.content ?? []),
      ...mediaBindings
        .filter(({ assetId }) => !inlineIds.has(assetId))
        .map(({ assetId }) => ({
          type: 'image',
          attrs: { assetId, alt: '' },
        })),
    ],
  });
  return articleContentSchema.parse({
    schemaVersion: 2,
    title: post.title,
    document,
    mediaBindings,
    coverAssetId: post.coverAssetId,
  });
}

import type {
  ArticleContentDto,
  ArticleContentInput,
  ArticleDto,
  ArticleMediaBindingInput,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { articleContentSchema } from '@/shared/contracts/article';
import type { ArticleEditorSessionMetadata } from '@/renderer/components/creator/article-editor/articleEditorSession';

export function editableArticleContentDto(content: ArticleContentDto): ArticleContentInput {
  const { mediaAssets: _mediaAssets, ...editable } = content;
  return {
    ...editable,
    mediaBindings: editable.mediaBindings.map((binding) => ({ ...binding })),
  };
}

export function editableArticleContent(article: ArticleDto): ArticleContentInput {
  return editableArticleContentDto(article.content);
}

export function articleEditorMetadataFromContent(input: ArticleContentInput): ArticleEditorSessionMetadata {
  const content = articleContentSchema.parse(input);
  return {
    schemaVersion: content.schemaVersion,
    title: content.title,
    mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })),
    coverAssetId: content.coverAssetId,
  };
}

export function articleEditorMetadata(article: ArticleDto): ArticleEditorSessionMetadata {
  return articleEditorMetadataFromContent(editableArticleContent(article));
}

export function articleEditorMedia(article: ArticleDto): VideoDocumentRevisionMediaDto[] {
  return articleEditorMediaFromContent(article.content);
}

export function articleEditorMediaFromContent(content: ArticleContentDto): VideoDocumentRevisionMediaDto[] {
  return content.mediaAssets.map((asset) => ({
    assetId: asset.id,
    mediaUrl: asset.mediaUrl,
    mimeType: asset.mimeType as VideoDocumentRevisionMediaDto['mimeType'],
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize ?? 0,
    durationMs: null,
  }));
}

export function articleEditorSnapshot(metadata: ArticleEditorSessionMetadata, markdown: string): ArticleContentInput {
  return articleContentSchema.parse({
    ...metadata,
    markdown,
    mediaBindings: metadata.mediaBindings.map(({ path, assetId }) => ({ path, assetId })),
  });
}

export function metadataAfterImageImport(
  metadata: ArticleEditorSessionMetadata,
  binding: ArticleMediaBindingInput,
): ArticleEditorSessionMetadata {
  const articleBinding = { path: binding.path, assetId: binding.assetId };
  if (metadata.mediaBindings.some((candidate) => candidate.assetId === articleBinding.assetId)) return metadata;
  return {
    ...metadata,
    mediaBindings: [...metadata.mediaBindings, articleBinding],
    coverAssetId: metadata.coverAssetId ?? articleBinding.assetId,
  };
}

export function mergeArticleEditorMedia(
  current: readonly VideoDocumentRevisionMediaDto[],
  incoming: readonly VideoDocumentRevisionMediaDto[],
) {
  const merged = new Map(current.map((item) => [item.assetId, item]));
  incoming.forEach((item) => merged.set(item.assetId, item));
  return [...merged.values()];
}

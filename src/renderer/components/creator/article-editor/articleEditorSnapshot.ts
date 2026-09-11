import { replaceContentPromptText } from '@/shared/content-document';
import type { ArticleEditorSessionMetadata } from '@/renderer/components/creator/article-editor/articleEditorSession';
import type {
  ArticleContentDto,
  ArticleContentInput,
  ArticleDto,
  ArticleMediaBindingInput,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { articleContentSchema } from '@/shared/contracts/article';
import { blockDocumentAssetIds, type BlockDocument } from '@/shared/contracts/block-document';

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
    document: content.document,
    title: content.title,
    mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })),
    coverAssetId: content.coverAssetId,
    ...(content.creationInput ? { creationInput: content.creationInput } : {}),
    ...(content.files ? { files: content.files } : {}),
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

export function articleEditorSnapshot(
  metadata: ArticleEditorSessionMetadata,
  markdown: string,
  document: BlockDocument | undefined = metadata.document,
): ArticleContentInput {
  const referenced = document ? new Set(blockDocumentAssetIds(document)) : null;
  if (metadata.coverAssetId) referenced?.add(metadata.coverAssetId);
  for (const id of metadata.creationInput?.referenceAssetIds ?? []) referenced?.add(id);
  // Retain imported media in the live session for undo, while saving only the
  // body and cover references. Removed occurrences must not fill the binding limit.
  const bindings = referenced
    ? metadata.mediaBindings.filter((binding) => referenced.has(binding.assetId))
    : metadata.mediaBindings;
  return articleContentSchema.parse({
    ...metadata,
    ...(document ? { schemaVersion: 2, document } : {}),
    markdown,
    ...(metadata.creationInput
      ? {
          creationInput: {
            ...metadata.creationInput,
            promptNodes: replaceContentPromptText(metadata.creationInput.promptNodes, markdown),
          },
        }
      : {}),
    mediaBindings: bindings.map(({ path, assetId }) => ({ path, assetId })),
  });
}

export function metadataAfterImageImport(
  metadata: ArticleEditorSessionMetadata,
  binding: ArticleMediaBindingInput,
): ArticleEditorSessionMetadata {
  const articleBinding = { path: binding.path, assetId: binding.assetId };
  const existing = metadata.mediaBindings.find((candidate) => candidate.path === articleBinding.path);
  if (existing) {
    if (existing.assetId !== articleBinding.assetId) throw new Error('ARTICLE_MEDIA_PATH_CONFLICT');
    return metadata;
  }
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

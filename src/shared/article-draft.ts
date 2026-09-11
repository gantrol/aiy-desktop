import type { ArticleContentInput, ArticleDto } from '@/shared/contracts';
import { articleContentSchema } from '@/shared/contracts/article';
import { inspirationStashContentSchema, type InspirationStashContentInput } from '@/shared/contracts/inspiration-stash';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { contentAssetPath, plainTextMarkdown } from '@/shared/content-document';
import { replaceMarkdownMedia } from '@/shared/content-markdown';
import { contentDisplayTitle } from '@/shared/content-document';
import type { InspirationStashDto } from '@/shared/contracts';

export function articleDraftDto(article: ArticleDto): InspirationStashDto {
  const content = articleDraftInput(article.content);
  return {
    id: article.id,
    revisionId: article.revisionId,
    albumId: article.albumId,
    title: content.title ?? '',
    displayTitle: contentDisplayTitle(article.content.title, article.content.markdown),
    content: { ...content, referenceAssets: article.content.mediaAssets },
    contentHash: article.contentHash,
    status: article.status,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

/** Legacy input adapters never own another copy of an article's body. */
export function articleDraftContent(
  input: InspirationStashContentInput,
  previous?: ArticleContentInput,
): ArticleContentInput {
  const content = inspirationStashContentSchema.parse(input);
  const mediaBindings = [...new Set(content.referenceAssetIds)].map((assetId) => ({
    path: contentAssetPath(assetId),
    assetId,
  }));
  return articleContentSchema.parse({
    schemaVersion: content.document ? 2 : 1,
    ...(content.document ? { document: content.document } : {}),
    title: content.title ?? previous?.title ?? '',
    markdown: content.format === 'markdown' ? content.manualPrompt : plainTextMarkdown(content.manualPrompt),
    mediaBindings,
    coverAssetId:
      previous?.coverAssetId && content.referenceAssetIds.includes(previous.coverAssetId)
        ? previous.coverAssetId
        : null,
    creationInput: {
      promptNodes: content.promptNodes,
      termPromptLocale: content.termPromptLocale,
      termIds: content.termIds,
      wordPaletteReferences: content.wordPaletteReferences,
      referenceAssetIds: content.referenceAssetIds,
      ...(content.settings
        ? { settings: content.settings }
        : previous?.creationInput?.settings
          ? { settings: previous.creationInput.settings }
          : {}),
    },
    ...(content.files ? { files: content.files } : previous?.files ? { files: previous.files } : {}),
  });
}

export function articleDraftInput(content: ArticleContentInput): InspirationStashContentInput {
  const markdown = content.document
    ? blockDocumentMarkdown(content.document)
    : replaceMarkdownMedia(
        content.markdown,
        new Map(content.mediaBindings.map((binding) => [binding.path, contentAssetPath(binding.assetId)])),
      );
  return inspirationStashContentSchema.parse({
    schemaVersion: content.document ? 2 : 1,
    ...(content.document ? { document: content.document } : {}),
    title: content.title,
    format: 'markdown',
    manualPrompt: markdown,
    promptNodes: content.creationInput?.promptNodes ?? [{ kind: 'TEXT', text: markdown }],
    referenceAssetIds: [...new Set(content.mediaBindings.map((binding) => binding.assetId))],
    termPromptLocale: content.creationInput?.termPromptLocale ?? 'en',
    termIds: content.creationInput?.termIds ?? [],
    wordPaletteReferences: content.creationInput?.wordPaletteReferences ?? [],
    ...(content.creationInput?.settings ? { settings: content.creationInput.settings } : {}),
    ...(content.files ? { files: content.files } : {}),
  });
}

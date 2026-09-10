import {
  articleMediaBindings,
  emptyArticleContent,
  markdownWithImages,
} from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { contentAssetPath } from '@/shared/content-document';
import { contentMarkdownMediaPaths, replaceMarkdownMedia } from '@/shared/content-markdown';
import type {
  ArticleDto,
  AssetDto,
  CreationItemDto,
  InspirationStashDto,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { blockDocumentAssetIds, captureBlockDocument } from '@/shared/contracts/block-document';
import type { SocialPostRevisionSaveInput } from '@/shared/contracts/social-post';

interface Options {
  creationItems: readonly CreationItemDto[];
  inspirationStashes: readonly InspirationStashDto[];
  locale: Locale;
  notify(message: string): void;
  onSaved(post: SocialPostDto): void;
  onOpenArticle(article: ArticleDto): void;
  refresh(): Promise<void>;
}

function socialPostContentSnapshot(content: SocialPostContentInput): SocialPostContentInput {
  return {
    ...content,
    ...(content.document ? { document: captureBlockDocument(content.document.root, [], true) } : {}),
    mediaAssetIds: [...content.mediaAssetIds],
  };
}

export function useCreatorSocialPostWorkflow(options: Options) {
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const notify = useStableCallback(options.notify);
  const openArticle = useStableCallback(options.onOpenArticle);
  const refresh = useStableCallback(options.refresh);

  function activeSourceId(sourceId: string | null) {
    return sourceId && options.inspirationStashes.some((stash) => stash.id === sourceId) ? sourceId : null;
  }

  function formId(entityId: string) {
    const context = creationFormByEntity(options.creationItems, 'SOCIAL_POST', entityId);
    if (!context) {
      throw new Error(socialCopy.itemUnavailable);
    }
    return context.form.id;
  }

  const finishArticle = useStableCallback(async (article: ArticleDto, message: string) => {
    await refresh();
    openArticle(article);
    notify(message);
  });

  const createArticleFromSocialPost = useStableCallback(
    async (
      post: SocialPostDto,
      content: SocialPostContentInput,
      mediaAssets: readonly AssetDto[],
      copySourceContent: boolean,
    ) => {
      const contentSnapshot = socialPostContentSnapshot(content);
      const byId = new Map(mediaAssets.map((asset) => [asset.id, asset]));
      const orderedAssets = contentSnapshot.mediaAssetIds.flatMap((assetId) => byId.get(assetId) ?? []);
      const mediaBindings = articleMediaBindings(orderedAssets, 'post');
      const inlineMedia = contentMarkdownMediaPaths(contentSnapshot.body);
      const inlineIds = new Set(contentSnapshot.document ? blockDocumentAssetIds(contentSnapshot.document) : []);
      const document = contentSnapshot.document
        ? captureBlockDocument({
            ...contentSnapshot.document.root,
            content: [
              ...(contentSnapshot.document.root.content ?? []),
              ...mediaBindings
                .filter((binding) => !inlineIds.has(binding.assetId))
                .map((binding) => ({ type: 'image', attrs: { assetId: binding.assetId, alt: '' } })),
            ],
          })
        : undefined;
      const article = await window.desktopApi.articleFormCreate({
        sourceFormId: formId(post.id),
        sourceInspirationStashId: activeSourceId(post.sourceInspirationStashId),
        content: copySourceContent
          ? {
              schemaVersion: document ? 2 : 1,
              ...(document ? { document } : {}),
              title: contentSnapshot.title,
              markdown: document
                ? blockDocumentMarkdown(document, mediaBindings)
                : contentSnapshot.format === 'markdown'
                  ? [
                      replaceMarkdownMedia(
                        contentSnapshot.body,
                        new Map(mediaBindings.map((binding) => [contentAssetPath(binding.assetId), binding.path])),
                      ),
                      ...mediaBindings
                        .filter((binding) => !inlineMedia.has(contentAssetPath(binding.assetId)))
                        .map((binding) => '![](' + binding.path + ')'),
                    ]
                      .filter(Boolean)
                      .join('\n\n')
                  : markdownWithImages(contentSnapshot.body, mediaBindings, options.locale),
              mediaBindings,
              coverAssetId: contentSnapshot.coverAssetId,
            }
          : emptyArticleContent(),
      });
      await finishArticle(article, copySourceContent ? socialCopy.articleConverted : socialCopy.articleCreated);
    },
  );

  const saveSocialPost = useStableCallback(async (request: SocialPostRevisionSaveInput, spaceId?: string) => {
    const result = await window.desktopApi.socialPostRevisionSave(request, spaceId);
    if (result.status === 'ACKNOWLEDGED') options.onSaved(result.post);
    return result;
  });

  return {
    createArticleFromSocialPost,
    saveSocialPost,
  };
}

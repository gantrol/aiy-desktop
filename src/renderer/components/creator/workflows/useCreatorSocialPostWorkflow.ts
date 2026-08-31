import type {
  ArticleDto,
  AssetDto,
  CreationItemDto,
  InspirationStashDto,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import {
  articleMediaBindings,
  emptyArticleContent,
  emptySocialPostContent,
  markdownWithImages,
} from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface CreateSocialPostFromDraftInput {
  content: SocialPostContentInput;
  creationDraftId: string;
  creationDraftCommitIdentity: string;
  sourceInspirationStashId: string | null;
  targetAlbumId: string | null;
}

interface Options {
  creationItems: readonly CreationItemDto[];
  getCreationDraftCommitIdentity(): string | null;
  inspirationStashes: readonly InspirationStashDto[];
  locale: Locale;
  notify(message: string): void;
  onDraftSocialPostCreated(post: SocialPostDto): void;
  onOpenArticle(article: ArticleDto): void;
  onOpenSocialPost(post: SocialPostDto): void;
  refresh(): Promise<void>;
}

function socialPostContentSnapshot(content: SocialPostContentInput): SocialPostContentInput {
  return {
    ...content,
    mediaAssetIds: [...content.mediaAssetIds],
  };
}

export function useCreatorSocialPostWorkflow(options: Options) {
  const getCreationDraftCommitIdentity = useStableCallback(options.getCreationDraftCommitIdentity);
  const notify = useStableCallback(options.notify);
  const onDraftSocialPostCreated = useStableCallback(options.onDraftSocialPostCreated);
  const openArticle = useStableCallback(options.onOpenArticle);
  const openSocialPost = useStableCallback(options.onOpenSocialPost);
  const refresh = useStableCallback(options.refresh);

  function activeSourceId(sourceId: string | null) {
    return sourceId && options.inspirationStashes.some((stash) => stash.id === sourceId) ? sourceId : null;
  }

  function formId(entityId: string) {
    const context = creationFormByEntity(options.creationItems, 'SOCIAL_POST', entityId);
    if (!context) {
      throw new Error(options.locale === 'zh' ? '所属创作项不可用' : 'The containing creation item is unavailable');
    }
    return context.form.id;
  }

  const finishArticle = useStableCallback(async (article: ArticleDto, message: string) => {
    await refresh();
    openArticle(article);
    notify(message);
  });

  const finishSocialPost = useStableCallback(async (post: SocialPostDto, message: string) => {
    await refresh();
    openSocialPost(post);
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
      const article = await window.desktopApi.articleFormCreate({
        sourceFormId: formId(post.id),
        sourceInspirationStashId: activeSourceId(post.sourceInspirationStashId),
        content: copySourceContent
          ? {
              schemaVersion: 1,
              title: contentSnapshot.title,
              markdown: markdownWithImages(contentSnapshot.body, mediaBindings, options.locale),
              mediaBindings,
              coverAssetId: contentSnapshot.coverAssetId,
            }
          : emptyArticleContent(),
      });
      await finishArticle(
        article,
        copySourceContent
          ? options.locale === 'zh'
            ? '已转为文章'
            : 'Converted to article'
          : options.locale === 'zh'
            ? '已新建文章'
            : 'Article created',
      );
    },
  );

  const createSocialPostFromSocialPost = useStableCallback(
    async (sourcePost: SocialPostDto, content: SocialPostContentInput, copySourceContent: boolean) => {
      const post = await window.desktopApi.socialPostFormCreate({
        sourceFormId: formId(sourcePost.id),
        sourceInspirationStashId: activeSourceId(sourcePost.sourceInspirationStashId),
        content: copySourceContent ? socialPostContentSnapshot(content) : emptySocialPostContent(),
      });
      await finishSocialPost(
        post,
        copySourceContent
          ? options.locale === 'zh'
            ? '已克隆贴图'
            : 'Social post forked'
          : options.locale === 'zh'
            ? '已新建贴图'
            : 'Social post created',
      );
    },
  );

  const createSocialPostFromDraft = useStableCallback(async (input: CreateSocialPostFromDraftInput) => {
    const snapshot = {
      ...input,
      content: socialPostContentSnapshot(input.content),
    };
    const sourceItem = snapshot.sourceInspirationStashId
      ? creationItemByFormEntity(options.creationItems, 'INSPIRATION_STASH', snapshot.sourceInspirationStashId)
      : null;
    if (snapshot.sourceInspirationStashId && !sourceItem) {
      throw new Error(
        options.locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable',
      );
    }
    const post = sourceItem
      ? await window.desktopApi.socialPostFormAdd({
          creationItemId: sourceItem.id,
          sourceInspirationStashId: snapshot.sourceInspirationStashId,
          consumeCreationDraftId: snapshot.creationDraftId,
          content: snapshot.content,
        })
      : await window.desktopApi.socialPostSave({
          id: null,
          albumId: snapshot.targetAlbumId,
          sourceInspirationStashId: null,
          consumeCreationDraftId: snapshot.creationDraftId,
          content: snapshot.content,
        });
    await refresh();
    if (getCreationDraftCommitIdentity() !== snapshot.creationDraftCommitIdentity) return;
    onDraftSocialPostCreated(post);
    notify(options.locale === 'zh' ? '已创建贴图' : 'Social post created');
  });

  const saveSocialPost = useStableCallback(async (post: SocialPostDto, content: SocialPostContentInput) => {
    const savedPost = await window.desktopApi.socialPostSave({
      id: post.id,
      albumId: post.albumId,
      sourceInspirationStashId: post.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content: socialPostContentSnapshot(content),
    });
    await refresh();
    return savedPost;
  });

  return {
    createArticleFromSocialPost,
    createSocialPostFromDraft,
    createSocialPostFromSocialPost,
    saveSocialPost,
  };
}

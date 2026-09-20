import type {
  ArticleContentInput,
  ArticleCommentDto,
  ArticleCommentAnchorUpdateInput,
  ArticleDto,
  ArticleMediaBindingInput,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { articleCoverAssetIds, type ArticleCoverRatio, type ArticleCoverVariant } from '@/shared/article-covers';
import type { VideoDocumentEditorImageImport } from '@/renderer/features/content-editor/contentImageAsset';
import {
  articleEditorSaveIdentity,
  articleEditorSaveIdentityMatches,
  type ArticleEditorSessionState,
  type ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import {
  articleEditorMedia,
  articleEditorMetadata,
  articleEditorMetadataFromContent,
  mergeArticleEditorMedia,
  metadataAfterImageImport,
} from '@/renderer/components/creator/article-editor/articleEditorSnapshot';

type SessionListener = () => void;

interface ArticleEditorInitialDraft {
  content: ArticleContentInput;
  media: readonly VideoDocumentRevisionMediaDto[];
  commentAnchors?: readonly ArticleCommentAnchorUpdateInput[];
}

function initialSessionState(
  article: ArticleDto,
  epoch: string,
  initialDraft: ArticleEditorInitialDraft | undefined,
): ArticleEditorSessionState {
  const draftContent = initialDraft?.content;
  const anchors = new Map(initialDraft?.commentAnchors?.map((item) => [item.commentId, item.anchor]));
  return {
    session: {
      articleId: article.id,
      epoch,
    },
    persisted: {
      article,
      draftSeq: 0,
      revisionId: article.revisionId,
      contentHash: article.contentHash,
    },
    draft: {
      sequence: initialDraft ? 1 : 0,
      metadata: draftContent ? articleEditorMetadataFromContent(draftContent) : articleEditorMetadata(article),
      media: initialDraft?.media.map((item) => ({ ...item })) ?? articleEditorMedia(article),
      hasBody: Boolean((draftContent?.markdown ?? article.content.markdown).trim()),
      comments: article.comments.map((comment) => ({ ...comment, anchor: anchors.get(comment.id) ?? comment.anchor })),
    },
    save: { phase: 'idle' },
    lifecycle: 'active',
    editorPending: false,
    documentVersion: 0,
    externalArticle: null,
  };
}

function activeRequestMatches(state: ArticleEditorSessionState, input: ArticleRevisionSaveInput) {
  return (
    state.lifecycle === 'active' &&
    state.session.articleId === input.articleId &&
    state.session.epoch === input.sessionEpoch &&
    state.save.phase === 'saving' &&
    articleEditorSaveIdentityMatches(state.save.request, input)
  );
}

export class ArticleEditorSessionModel {
  readonly #listeners = new Set<SessionListener>();
  #state: ArticleEditorSessionState;

  constructor(article: ArticleDto, options: { epoch?: string; initialDraft?: ArticleEditorInitialDraft } = {}) {
    this.#state = initialSessionState(article, options.epoch ?? globalThis.crypto.randomUUID(), options.initialDraft);
  }

  readonly getSnapshot = () => this.#state;

  readonly subscribe = (listener: SessionListener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setEditorPending(editorPending: boolean) {
    if (this.#state.lifecycle === 'disposed' || this.#state.editorPending === editorPending) return;
    this.#commit({ ...this.#state, editorPending });
  }

  loadArticle(article: ArticleDto, initialDraft?: ArticleEditorInitialDraft) {
    const state = this.#state;
    if (state.lifecycle === 'disposed' || state.save.phase === 'saving' || state.save.phase === 'preparing')
      return false;
    this.#commit({
      ...initialSessionState(article, state.session.epoch, initialDraft),
      documentVersion: state.documentVersion + 1,
    });
    return true;
  }

  receiveExternalArticle(article: ArticleDto) {
    if (this.#state.lifecycle === 'disposed' || article.id !== this.#state.session.articleId) return;
    this.#commit({ ...this.#state, externalArticle: article });
  }

  updateComments(comments: readonly ArticleCommentDto[]) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return;
    this.#commit({
      ...state,
      persisted: { ...state.persisted, article: { ...state.persisted.article, comments: [...comments] } },
      draft: { ...state.draft, comments },
    });
  }

  beginPreparation(draftSeq: number) {
    if (this.#state.lifecycle === 'disposed') return;
    this.#commit({ ...this.#state, save: { phase: 'preparing', draftSeq } });
  }

  failPreparation(mode: ArticleSaveMode, message: string) {
    const state = this.#state;
    if (state.lifecycle === 'disposed' || state.save.phase === 'saving' || state.save.phase === 'conflict') return;
    this.#commit({
      ...state,
      save: {
        phase: 'failed',
        failure: { stage: 'prepare', draftSeq: state.draft.sequence, request: null, message, mode },
      },
    });
  }

  replaceDraft(content: ArticleContentInput, media: readonly VideoDocumentRevisionMediaDto[]) {
    const state = this.#state;
    if (state.lifecycle === 'disposed' || state.save.phase === 'saving' || state.save.phase === 'preparing')
      return false;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        sequence: state.draft.sequence + 1,
        metadata: articleEditorMetadataFromContent(content),
        media: media.map((item) => ({ ...item })),
        hasBody: Boolean(content.markdown.trim()),
      },
      save: { phase: 'idle' },
      documentVersion: state.documentVersion + 1,
    });
    return true;
  }

  setTitle(title: string) {
    const state = this.#state;
    if (state.lifecycle === 'disposed' || state.draft.metadata.title === title) return;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        metadata: { ...state.draft.metadata, title },
      },
    });
  }

  addImportedImage(binding: ArticleMediaBindingInput, media: VideoDocumentRevisionMediaDto) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        metadata: metadataAfterImageImport(state.draft.metadata, binding),
        media: mergeArticleEditorMedia(state.draft.media, [media]),
      },
    });
  }

  setCover(assetId: string | null) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return;
    if (state.draft.metadata.coverAssetId === assetId && (assetId || !state.draft.metadata.coverVariants?.length))
      return;
    if (assetId && !state.draft.metadata.mediaBindings.some((binding) => binding.assetId === assetId)) return;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        metadata: {
          ...state.draft.metadata,
          coverAssetId: assetId,
          ...(assetId ? {} : { coverVariants: undefined }),
        },
      },
    });
  }

  setCoverVariant(
    ratio: ArticleCoverRatio,
    variant: ArticleCoverVariant | null,
    imported: readonly VideoDocumentEditorImageImport[],
    bodyAssetIds: readonly string[],
  ) {
    const metadata = this.#state.draft.metadata;
    const coverVariants = (metadata.coverVariants ?? []).filter((cover) => cover.ratio !== ratio);
    if (variant) coverVariants.push({ ...variant, ratio });
    return this.setCovers(
      metadata.coverAssetId ?? variant?.sourceAssetId ?? null,
      coverVariants,
      imported,
      bodyAssetIds,
    );
  }

  setCovers(
    coverAssetId: string | null,
    coverVariants: readonly ArticleCoverVariant[],
    imported: readonly VideoDocumentEditorImageImport[],
    bodyAssetIds: readonly string[],
  ) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return false;
    const metadata = state.draft.metadata;
    const retained = new Set([
      ...bodyAssetIds,
      ...(metadata.creationInput?.referenceAssetIds ?? []),
      ...articleCoverAssetIds({ coverAssetId, coverVariants }),
    ]);
    const retired = new Set(
      (metadata.coverVariants ?? []).flatMap((previous) =>
        previous.assetId !== previous.sourceAssetId && !retained.has(previous.assetId) ? [previous.assetId] : [],
      ),
    );
    const mediaBindings = metadata.mediaBindings.filter((binding) => !retired.has(binding.assetId));
    for (const image of imported) {
      if (!mediaBindings.some((binding) => binding.assetId === image.binding.assetId))
        mediaBindings.push({ path: image.binding.path, assetId: image.binding.assetId });
    }
    if (
      mediaBindings.length > 100 ||
      articleCoverAssetIds({ coverAssetId, coverVariants }).some(
        (id) => !mediaBindings.some((binding) => binding.assetId === id),
      )
    )
      return false;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        metadata: {
          ...metadata,
          mediaBindings,
          coverAssetId,
          coverVariants: coverVariants.length
            ? coverVariants.map((variant) => ({ ...variant, crop: { ...variant.crop } }))
            : undefined,
        },
        media: mergeArticleEditorMedia(
          state.draft.media.filter((asset) => !retired.has(asset.assetId)),
          imported.map((image) => image.media),
        ),
      },
    });
    return true;
  }

  removeImage(assetId: string) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return false;
    const mediaBindings = state.draft.metadata.mediaBindings.filter((binding) => binding.assetId !== assetId);
    if (mediaBindings.length === state.draft.metadata.mediaBindings.length) return false;
    const retainedAssetIds = new Set(mediaBindings.map((binding) => binding.assetId));
    const currentCover = state.draft.metadata.coverAssetId;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        metadata: {
          ...state.draft.metadata,
          mediaBindings,
          coverVariants: state.draft.metadata.coverVariants?.filter(
            (cover) => cover.assetId !== assetId && cover.sourceAssetId !== assetId,
          ),
          coverAssetId:
            currentCover && retainedAssetIds.has(currentCover) ? currentCover : (mediaBindings[0]?.assetId ?? null),
        },
        media: state.draft.media.filter((item) => retainedAssetIds.has(item.assetId)),
      },
    });
    return true;
  }

  beginDraft(hasBody: boolean) {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return state.draft.sequence;
    const sequence = state.draft.sequence + 1;
    this.#commit({
      ...state,
      draft: {
        ...state.draft,
        sequence,
        hasBody,
      },
    });
    return sequence;
  }

  beginSave(input: ArticleRevisionSaveInput) {
    const state = this.#state;
    if (
      state.lifecycle === 'disposed' ||
      state.session.articleId !== input.articleId ||
      state.session.epoch !== input.sessionEpoch ||
      state.persisted.revisionId !== input.expectedRevisionId ||
      input.draftSeq <= state.persisted.draftSeq ||
      input.draftSeq > state.draft.sequence ||
      state.save.phase === 'saving' ||
      state.save.phase === 'conflict'
    ) {
      return false;
    }
    this.#commit({
      ...state,
      save: { phase: 'saving', request: articleEditorSaveIdentity(input) },
    });
    return true;
  }

  acknowledgeSave(input: ArticleRevisionSaveInput, savedArticle: ArticleDto) {
    const state = this.#state;
    if (!activeRequestMatches(state, input) || savedArticle.id !== state.session.articleId) return false;
    this.#commit({
      ...state,
      persisted: {
        article: savedArticle,
        draftSeq: input.draftSeq,
        revisionId: savedArticle.revisionId,
        contentHash: input.contentHash,
      },
      draft: {
        ...state.draft,
        media: mergeArticleEditorMedia(state.draft.media, articleEditorMedia(savedArticle)),
        comments: savedArticle.comments,
      },
      save: { phase: 'idle' },
    });
    return true;
  }

  failSave(input: ArticleRevisionSaveInput, mode: ArticleSaveMode, message: string) {
    const state = this.#state;
    if (!activeRequestMatches(state, input)) return false;
    this.#commit({
      ...state,
      save: {
        phase: 'failed',
        failure: {
          request: articleEditorSaveIdentity(input),
          stage: 'persist',
          draftSeq: input.draftSeq,
          message,
          mode,
        },
      },
    });
    return true;
  }

  enterConflict(input: ArticleRevisionSaveInput, conflict: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>) {
    const state = this.#state;
    if (!activeRequestMatches(state, input) || conflict.currentArticle.id !== state.session.articleId) return false;
    this.#commit({
      ...state,
      save: {
        phase: 'conflict',
        conflict: {
          ...articleEditorSaveIdentity(input),
          currentRevisionId: conflict.currentArticle.revisionId,
          reason: conflict.reason,
        },
      },
    });
    return true;
  }

  dispose() {
    const state = this.#state;
    if (state.lifecycle === 'disposed') return;
    this.#commit({
      ...state,
      save: { phase: 'idle' },
      lifecycle: 'disposed',
    });
  }

  #commit(state: ArticleEditorSessionState) {
    if (Object.is(this.#state, state)) return;
    this.#state = state;
    this.#listeners.forEach((listener) => listener());
  }
}

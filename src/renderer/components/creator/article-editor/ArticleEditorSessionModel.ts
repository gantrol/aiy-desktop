import type {
  ArticleContentInput,
  ArticleDto,
  ArticleMediaBindingInput,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
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
}

function initialSessionState(
  article: ArticleDto,
  epoch: string,
  initialDraft: ArticleEditorInitialDraft | undefined,
): ArticleEditorSessionState {
  const draftContent = initialDraft?.content;
  return {
    session: {
      articleId: article.id,
      epoch,
    },
    persisted: {
      draftSeq: 0,
      revisionId: article.revisionId,
      contentHash: article.contentHash,
    },
    draft: {
      sequence: initialDraft ? 1 : 0,
      metadata: draftContent ? articleEditorMetadataFromContent(draftContent) : articleEditorMetadata(article),
      media: initialDraft?.media.map((item) => ({ ...item })) ?? articleEditorMedia(article),
      hasBody: Boolean((draftContent?.markdown ?? article.content.markdown).trim()),
    },
    save: { phase: 'idle' },
    lifecycle: 'active',
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

  replaceDraft(content: ArticleContentInput, media: readonly VideoDocumentRevisionMediaDto[]) {
    const state = this.#state;
    if (state.lifecycle === 'disposed' || state.save.phase === 'saving') return false;
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
        draftSeq: input.draftSeq,
        revisionId: savedArticle.revisionId,
        contentHash: input.contentHash,
      },
      draft: {
        ...state.draft,
        media: mergeArticleEditorMedia(state.draft.media, articleEditorMedia(savedArticle)),
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
        failure: { ...articleEditorSaveIdentity(input), message, mode },
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

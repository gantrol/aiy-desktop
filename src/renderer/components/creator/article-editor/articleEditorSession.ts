import type {
  ArticleCommentDto,
  ArticleDto,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import type { BlockDocument } from '@/shared/contracts/block-document';

export type ArticleSaveMode = 'auto' | 'manual';

export interface ArticleEditorSessionMetadata {
  readonly schemaVersion: 1 | 2;
  readonly document?: BlockDocument;
  readonly title: string;
  readonly mediaBindings: ArticleRevisionSaveInput['content']['mediaBindings'];
  readonly coverAssetId: string | null;
  readonly creationInput?: ArticleRevisionSaveInput['content']['creationInput'];
  readonly files?: ArticleRevisionSaveInput['content']['files'];
}

export interface ArticleEditorSaveIdentity {
  readonly articleId: string;
  readonly expectedRevisionId: string;
  readonly requestId: string;
  readonly sessionEpoch: string;
  readonly draftSeq: number;
  readonly contentHash: string;
}

export interface ArticleEditorSaveFailure {
  readonly message: string;
  readonly mode: ArticleSaveMode;
  readonly stage: 'prepare' | 'persist';
  readonly draftSeq: number;
  readonly request: ArticleEditorSaveIdentity | null;
}

export interface ArticleEditorConflict extends ArticleEditorSaveIdentity {
  readonly currentRevisionId: string;
  readonly reason: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>['reason'];
}

export interface ArticleEditorSessionIdentity {
  readonly articleId: string;
  readonly epoch: string;
}

export interface ArticleEditorPersistedBaseline {
  readonly article: ArticleDto;
  readonly draftSeq: number;
  readonly revisionId: string;
  readonly contentHash: string;
}

export interface ArticleEditorDraftState {
  readonly sequence: number;
  readonly metadata: ArticleEditorSessionMetadata;
  readonly media: readonly VideoDocumentRevisionMediaDto[];
  readonly hasBody: boolean;
  readonly comments: readonly ArticleCommentDto[];
}

export type ArticleEditorSaveState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'preparing'; readonly draftSeq: number }
  | { readonly phase: 'saving'; readonly request: ArticleEditorSaveIdentity }
  | { readonly phase: 'failed'; readonly failure: ArticleEditorSaveFailure }
  | { readonly phase: 'conflict'; readonly conflict: ArticleEditorConflict };

export interface ArticleEditorSessionState {
  readonly session: ArticleEditorSessionIdentity;
  readonly persisted: ArticleEditorPersistedBaseline;
  readonly draft: ArticleEditorDraftState;
  readonly save: ArticleEditorSaveState;
  readonly lifecycle: 'active' | 'disposed';
  readonly editorPending: boolean;
  readonly documentVersion: number;
  readonly externalArticle: ArticleDto | null;
}

export function articleEditorSaveIdentity(input: ArticleRevisionSaveInput): ArticleEditorSaveIdentity {
  return {
    articleId: input.articleId,
    expectedRevisionId: input.expectedRevisionId,
    requestId: input.requestId,
    sessionEpoch: input.sessionEpoch,
    draftSeq: input.draftSeq,
    contentHash: input.contentHash,
  };
}

export function articleEditorSaveIdentityMatches(identity: ArticleEditorSaveIdentity, input: ArticleRevisionSaveInput) {
  return (
    identity.articleId === input.articleId &&
    identity.expectedRevisionId === input.expectedRevisionId &&
    identity.requestId === input.requestId &&
    identity.sessionEpoch === input.sessionEpoch &&
    identity.draftSeq === input.draftSeq &&
    identity.contentHash === input.contentHash
  );
}

export function articleEditorSaveResultMatches(input: ArticleRevisionSaveInput, result: ArticleRevisionSaveResult) {
  return (
    result.requestId === input.requestId &&
    result.sessionEpoch === input.sessionEpoch &&
    result.draftSeq === input.draftSeq
  );
}

export function articleEditorSessionDirty(state: ArticleEditorSessionState) {
  return state.editorPending || state.draft.sequence > state.persisted.draftSeq;
}

export function articleEditorSessionSaving(state: ArticleEditorSessionState) {
  return state.save.phase === 'saving' || state.save.phase === 'preparing';
}

export function articleEditorSessionFailed(state: ArticleEditorSessionState) {
  return state.save.phase === 'failed';
}

export function articleEditorSessionConflicted(state: ArticleEditorSessionState) {
  return state.save.phase === 'conflict' || state.externalArticle !== null;
}

export const selectArticleEditorDocumentVersion = (state: ArticleEditorSessionState) => state.documentVersion;
export const selectArticleEditorComments = (state: ArticleEditorSessionState) => state.draft.comments;

export function selectArticleEditorTitle(state: ArticleEditorSessionState) {
  return state.draft.metadata.title;
}

export function selectArticleEditorMediaBindings(state: ArticleEditorSessionState) {
  return state.draft.metadata.mediaBindings;
}

export function selectArticleEditorMedia(state: ArticleEditorSessionState) {
  return state.draft.media;
}

export function selectArticleEditorHasBody(state: ArticleEditorSessionState) {
  return state.draft.hasBody;
}

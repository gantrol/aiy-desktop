import type {
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';

export type ArticleSaveMode = 'auto' | 'manual';

export interface ArticleEditorSessionMetadata {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly mediaBindings: ArticleRevisionSaveInput['content']['mediaBindings'];
  readonly coverAssetId: string | null;
}

export interface ArticleEditorSaveIdentity {
  readonly requestId: string;
  readonly sessionEpoch: string;
  readonly draftSeq: number;
  readonly contentHash: string;
}

export interface ArticleEditorSaveFailure extends ArticleEditorSaveIdentity {
  readonly message: string;
  readonly mode: ArticleSaveMode;
}

export interface ArticleEditorConflict extends ArticleEditorSaveIdentity {
  readonly expectedRevisionId: string;
  readonly currentRevisionId: string;
  readonly reason: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>['reason'];
  readonly historicalRevisionId: string | null;
  readonly historicalRevisionNo: number | null;
}

export interface ArticleEditorSessionIdentity {
  readonly articleId: string;
  readonly epoch: string;
}

export interface ArticleEditorPersistedBaseline {
  readonly revisionId: string;
  readonly contentHash: string;
}

export interface ArticleEditorDraftState {
  readonly sequence: number;
  readonly contentHash: string | null;
  readonly metadata: ArticleEditorSessionMetadata;
  readonly media: readonly VideoDocumentRevisionMediaDto[];
  readonly hasBody: boolean;
}

export type ArticleEditorSaveState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'saving'; readonly request: ArticleEditorSaveIdentity }
  | { readonly phase: 'failed'; readonly failure: ArticleEditorSaveFailure }
  | { readonly phase: 'conflict'; readonly conflict: ArticleEditorConflict };

export interface ArticleEditorSessionState {
  readonly session: ArticleEditorSessionIdentity;
  readonly persisted: ArticleEditorPersistedBaseline;
  readonly draft: ArticleEditorDraftState;
  readonly save: ArticleEditorSaveState;
  readonly lifecycle: 'active' | 'disposed';
}

export function articleEditorSaveIdentity(input: ArticleRevisionSaveInput): ArticleEditorSaveIdentity {
  return {
    requestId: input.requestId,
    sessionEpoch: input.sessionEpoch,
    draftSeq: input.draftSeq,
    contentHash: input.contentHash,
  };
}

export function articleEditorSaveIdentityMatches(identity: ArticleEditorSaveIdentity, input: ArticleRevisionSaveInput) {
  return (
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
  return state.draft.contentHash === null || state.draft.contentHash !== state.persisted.contentHash;
}

export function articleEditorSessionSaving(state: ArticleEditorSessionState) {
  return state.save.phase === 'saving';
}

export function articleEditorSessionFailed(state: ArticleEditorSessionState) {
  return state.save.phase === 'failed';
}

export function articleEditorSessionConflicted(state: ArticleEditorSessionState) {
  return state.save.phase === 'conflict';
}

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

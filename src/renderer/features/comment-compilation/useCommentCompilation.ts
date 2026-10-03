import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { announceArticleCreated } from '@/renderer/features/content-editor/articleCreated';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import {
  commentCompilationState,
  type CommentCompilationDraft,
} from '@/renderer/features/comment-compilation/commentCompilationState';
import { commentCompilationFailure } from '@/renderer/features/comment-compilation/commentCompilationFailure';
import { prepareCompilationDraft } from '@/renderer/features/comment-compilation/commentCompilationPreparation';
import { openCompiledArticle } from '@/renderer/features/comment-compilation/openCompiledArticle';
import { useI18n } from '@/renderer/i18n/useI18n';
import { COMMENT_COMPILATION_LIMIT, commentCompilationInputSchema } from '@/shared/contracts/comment-compilation';
import type { CommentCompilationResult } from '@/shared/contracts/comment-compilation-result';

export function useCommentCompilation(externalBusy: boolean) {
  const host = useOutlineContentLinkHost();
  const registry = useArticleEditorSessions();
  const session = host ? registry?.find(host.spaceId, host.articleId) : undefined;
  const workspace = useWorkspaceArticleEditorState(host?.articleId ?? '');
  const container = useWorkspacePaneContainer();
  const store = commentCompilationState(session);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const owner = useId();
  const copy = useI18n().messages.commentCompilation;
  const epoch = useRef(0);
  const current = useRef(workspace.navigationEntryId);
  current.current = workspace.navigationEntryId;
  useEffect(
    () => () => {
      epoch.current++;
    },
    [session],
  );
  const supported = Boolean(host && session && workspace.tabId);
  const blocked = externalBusy || state.busy;
  const locked = blocked || Boolean(state.pending);

  function captureCurrent() {
    const generation = epoch.current;
    const entry = current.current;
    return () => epoch.current === generation && current.current === entry;
  }

  function toggle(id: string) {
    const snapshot = store.getSnapshot();
    if (!supported || externalBusy || snapshot.busy || snapshot.pending || snapshot.result) return;
    const selected = snapshot.selectedIds;
    if (!selected.includes(id) && selected.length >= COMMENT_COMPILATION_LIMIT) return;
    store.update({
      selecting: true,
      selectedIds: selected.includes(id) ? selected.filter((key) => key !== id) : [...selected, id],
      draft: null,
      error: null,
    });
  }

  async function prepare(refresh = false) {
    if (!supported || !host || !session || externalBusy || store.getSnapshot().busy) return;
    const previous = store.getSnapshot();
    if ((!refresh && previous.draft) || previous.pending) {
      store.update({ owner });
      return;
    }
    if (!previous.selectedIds.length) return;
    const isCurrent = captureCurrent();
    const identity = session.getEditorSessionIdentity();
    const sourceIsCurrent = () => isCurrent() && session.getEditorSessionIdentity() === identity;
    store.update({ busy: true, error: null });
    try {
      if (!(await session.flush('manual'))) throw new Error('REFERENCE_SAVE_FAILED');
      if (!sourceIsCurrent()) return;
      // Comments can change without a new article revision. Read the repository on
      // both preparation and refresh; a successful flush does not refresh this cache.
      const loaded = await window.desktopApi.articleOpen({ spaceId: host.spaceId, articleId: host.articleId });
      if (!sourceIsCurrent()) return;
      if (loaded.spaceId !== host.spaceId || loaded.article.id !== host.articleId)
        throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const defaultTitle = copy.defaultTitle.replace('{title}', loaded.article.content.title || copy.untitled);
      const draft = prepareCompilationDraft(loaded.article, host.spaceId, previous, defaultTitle);
      store.update({ owner, draft });
    } catch (reason) {
      if (!sourceIsCurrent()) return;
      const error = commentCompilationFailure(reason);
      store.update({ error: error === 'failed' ? 'prepareFailed' : error });
    } finally {
      store.update({ busy: false });
    }
  }

  function changeDraft(
    change: Partial<Pick<CommentCompilationDraft, 'title' | 'format' | 'includeQuotes' | 'comments'>>,
  ) {
    const snapshot = store.getSnapshot();
    if (externalBusy || snapshot.busy || snapshot.pending || !snapshot.draft) return;
    const draft = { ...snapshot.draft, ...change };
    store.update({ draft, selectedIds: draft.comments.map((comment) => comment.id), error: null });
  }

  async function openResult(result: CommentCompilationResult) {
    if (!session || !host || externalBusy || store.getSnapshot().busy || result.spaceId !== host.spaceId) return;
    const currentRequest = captureCurrent();
    const isCurrent = () => currentRequest() && (!container || container.getClientRects().length > 0);
    store.update({ busy: true });
    try {
      await openCompiledArticle(result, {
        sourceTabId: workspace.tabId,
        originArticleId: host.articleId,
        isCurrent,
        flush: () => session.flush('manual'),
      });
      store.update({ error: null });
    } catch {
      store.update({ error: 'openFailed' });
    } finally {
      store.update({ busy: false });
    }
  }

  async function submit() {
    const snapshot = store.getSnapshot();
    if (!supported || externalBusy || snapshot.busy || !snapshot.draft) return;
    const parsed = commentCompilationInputSchema.safeParse(
      snapshot.pending ?? { ...snapshot.draft, requestId: crypto.randomUUID() },
    );
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join(' ');
      store.update({
        error: detail.includes('TOO_LARGE') ? 'tooLarge' : detail.includes('EMPTY') ? 'empty' : 'invalid',
      });
      return;
    }
    const isCurrent = captureCurrent();
    store.update({ pending: parsed.data, busy: true, error: null });
    let result: CommentCompilationResult;
    try {
      result = await contentLibraryApi().commentCompilationCreate(parsed.data);
      if (result.spaceId !== parsed.data.spaceId) throw new Error('COMMENT_COMPILATION_RESPONSE_MISMATCH');
      // Publish the committed registration before navigation. A closed source pane,
      // full destination or failed open must not hide the saved work from the library.
      announceArticleCreated(result);
      store.update({ result, pending: null, draft: null, owner: null, selecting: false, selectedIds: [] });
    } catch (reason) {
      const error = commentCompilationFailure(reason);
      // An unknown transport result retains exactly the same request for an idempotent retry.
      store.update({ error, ...(error === 'failed' ? {} : { pending: null }) });
      return;
    } finally {
      store.update({ busy: false });
    }
    if (isCurrent() && (!container || container.getClientRects().length > 0)) await openResult(result);
  }

  return {
    supported,
    state,
    locked,
    blocked,
    dialogOpen: state.owner === owner,
    begin: () => {
      const snapshot = store.getSnapshot();
      if (supported && !externalBusy && !snapshot.busy && !snapshot.pending) store.update({ selecting: true });
    },
    toggle,
    prepare,
    changeDraft,
    submit,
    openResult,
    close: () => {
      if (!store.getSnapshot().busy) store.update({ owner: null });
    },
    clear: () => {
      const snapshot = store.getSnapshot();
      if (!externalBusy && !snapshot.busy && !snapshot.pending) store.reset();
    },
  };
}
export type CommentCompilationController = ReturnType<typeof useCommentCompilation>;

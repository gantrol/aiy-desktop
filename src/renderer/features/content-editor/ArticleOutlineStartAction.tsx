import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ListTreeIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { articleOutlineStartState } from '@/renderer/features/content-editor/articleOutlineStartState';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { canStartArticleOutline } from '@/shared/article-outline-start';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleOutlineStartAction() {
  const host = useOutlineContentLinkHost();
  return host ? <ArticleOutlineStartControl /> : null;
}

function ArticleOutlineStartControl() {
  const session = useArticleEditorSession();
  const host = useOutlineContentLinkHost();
  const copy = useI18n().messages.articleOutlineStart;
  const store = articleOutlineStartState(session);
  const busy = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const available = useArticleEditorSessionSelector((state) =>
    canStartArticleOutline(session.getDocumentProjection(), state.draft.metadata.editorMode),
  );
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [session],
  );

  async function start() {
    if (!host || store.getSnapshot() || session.getRecoveryPending()) return;
    const generation = epoch.current;
    const identity = session.getEditorSessionIdentity();
    const isCurrent = () => generation === epoch.current && identity === session.getEditorSessionIdentity();
    store.setBusy(true);
    try {
      if (!store.pending) {
        if (!(await session.flush('manual')) || !isCurrent()) return;
        const snapshot = session.captureSnapshot();
        if (!canStartArticleOutline(snapshot.document, snapshot.editorMode)) {
          host.notify?.(copy.notEmpty);
          return;
        }
        const source = session.capturePersistedArticle();
        if (source.id !== host.articleId) throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
        store.pending = {
          spaceId: host.spaceId,
          articleId: source.id,
          expectedRevisionId: source.revisionId,
          requestId: crypto.randomUUID(),
        };
      }
      const request = store.pending;
      const result = await contentLibraryApi().articleOutlineStart(request);
      if (result.spaceId !== request.spaceId || result.article.id !== request.articleId)
        throw new Error('ARTICLE_OUTLINE_START_RESPONSE_MISMATCH');
      store.pending = null;
      if (!isCurrent()) return;
      // The session queues a conflict instead of overwriting input typed during the request.
      session.receiveTransferredArticle(result.article);
    } catch (reason) {
      const message = String(reason);
      if (/ARTICLE_OUTLINE_START_(NOT_EMPTY|CHANGED)|CONTENT_LIBRARY_SPACE_CHANGED/u.test(message))
        store.pending = null;
      if (!isCurrent()) return;
      if (message.includes('ARTICLE_OUTLINE_START_NOT_EMPTY')) host.notify?.(copy.notEmpty);
      else if (message.includes('ARTICLE_OUTLINE_START_CHANGED')) host.notify?.(copy.changed);
      else if (message.includes('CONTENT_LIBRARY_SPACE_CHANGED')) host.notify?.(copy.unavailable);
      else host.notify?.(copy.failed);
    } finally {
      store.setBusy(false);
    }
  }

  if (!host || (!available && !busy && !store.pending)) return null;
  return (
    <Button type="button" variant="ghost" size="sm" disabled={busy} aria-busy={busy} onClick={() => void start()}>
      {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ListTreeIcon className="size-4" />}
      {store.pending ? copy.retry : copy.useOutline}
    </Button>
  );
}

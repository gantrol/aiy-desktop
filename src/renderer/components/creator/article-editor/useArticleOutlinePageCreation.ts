import { useEffect, useRef } from 'react';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import type { ReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import {
  REFERENCE_NAVIGATION_EVENT,
  type ReferenceNavigationRequest,
} from '@/renderer/features/content-editor/contentReferenceNavigation';
import { announceArticleCreated } from '@/renderer/features/content-editor/articleCreated';
import { useI18n } from '@/renderer/i18n/useI18n';

/** The workspace survives document reloads; navigation must not belong to the replaced editor. */
export function useArticleOutlinePageCreation(): ReferenceHost['createOutlinePage'] {
  const session = useArticleEditorSession();
  const host = useOutlineContentLinkHost();
  const articleId = session.capturePersistedArticle().id;
  const { tabId, navigationEntryId } = useWorkspaceArticleEditorState(articleId);
  const copy = useI18n().messages.referenceOutline;
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [session, tabId, navigationEntryId, host?.spaceId],
  );
  if (!host) return undefined;
  return async (operation) => {
    const generation = epoch.current;
    const isCurrent = () => generation === epoch.current && session.model.getSnapshot().lifecycle === 'active';
    const result = await session.mutateStructure(async (source) => {
      if (!isCurrent() || source.id !== host.articleId) throw new Error('REFERENCE_TARGET_CHANGED');
      return operation(source);
    });
    if (!result) return false;
    announceArticleCreated({
      spaceId: result.link.spaceId,
      article: result.page,
      creationItem: result.creationItem,
    });
    if (!isCurrent()) return true;
    try {
      // The source commit is already received. Opening its page must not flush
      // the pre-conversion editor or depend on that editor's mounting lifetime.
      await new Promise<void>((resolve, reject) => {
        const request: ReferenceNavigationRequest = {
          target: { source: { kind: 'ARTICLE', id: result.page.id } },
          sourceTabId: tabId,
          committedOrigin: { spaceId: host.spaceId, navigationEntryId },
          originArticleId: articleId,
          placement: 'beside',
          isCurrent,
          accept: (operation) => void operation.then(resolve, reject),
        };
        if (window.dispatchEvent(new CustomEvent(REFERENCE_NAVIGATION_EVENT, { detail: request, cancelable: true })))
          reject(new Error('REFERENCE_NAVIGATION_UNSUPPORTED'));
      });
    } catch {
      if (isCurrent()) host.notify?.(copy.pageOpenFailed);
    }
    return true;
  };
}

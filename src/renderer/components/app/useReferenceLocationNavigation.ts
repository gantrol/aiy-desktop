import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import { referenceTargetSchema } from '@/shared/contracts/content-source';
import {
  REFERENCE_NAVIGATION_EVENT,
  type ReferenceNavigationRequest,
} from '@/renderer/features/content-editor/contentReferenceNavigation';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { useWorkspaceController } from '@/renderer/components/workspace/useWorkspaceController';
import { workspaceLocationKey } from '@/renderer/components/workspace/workspace-location';
import { activeLocation, activeNavigationEntry } from '@/renderer/components/workspace/workspace-state';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { liveReferenceLocation } from '@/renderer/features/content-editor/liveReferenceLocation';
import {
  ARTICLE_CREATED_EVENT,
  mergeCreatedArticle,
  type ArticleCreated,
} from '@/renderer/features/content-editor/articleCreated';

export function useReferenceLocationNavigation(
  data: Pick<BootstrapDto, 'spaceId'> | null,
  workspace: ReturnType<typeof useWorkspaceController>,
  setData: Dispatch<SetStateAction<BootstrapDto | null>>,
  flushers: { current: Map<string, () => void> },
  overlays: readonly Dispatch<SetStateAction<boolean>>[],
) {
  const sessions = useArticleEditorSessions();
  const options = { spaceId: data?.spaceId, workspace, setData, flushers, overlays, sessions };
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    let epoch = 0;
    const articleCreated = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const result = event.detail as ArticleCreated;
      current.current.setData((data) => mergeCreatedArticle(data, result));
    };
    const navigate = async (request: ReferenceNavigationRequest) => {
      const generation = ++epoch;
      const context = current.current;
      const spaceId = context.spaceId;
      const activeTabId = context.workspace.activeTab?.id;
      const tabId = request.sourceTabId || context.workspace.activeTab?.id;
      const source = tabId ? context.workspace.findTab(tabId) : null;
      if (!spaceId || !source || !tabId) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      const sourceKey = workspaceLocationKey(activeLocation(source.tab));
      const sourceEntryId = activeNavigationEntry(source.tab).id;
      context.flushers.current.get(tabId)?.();
      const session = ['ARTICLE', 'INSPIRATION_STASH'].includes(request.target.source.kind)
        ? context.sessions?.find(spaceId, request.target.source.id)
        : undefined;
      const live = session?.getDocumentProjection() ? session : undefined;
      const loaded = await contentLibraryApi().referenceOpen(
        referenceTargetSchema.parse(live ? { source: request.target.source } : request.target),
        live ? undefined : request.referenceId,
      );
      const latest = current.current;
      const latestSource = latest.workspace.findTab(tabId);
      if (
        generation !== epoch ||
        !request.isCurrent() ||
        latest.workspace.activeTab?.id !== activeTabId ||
        latest.spaceId !== spaceId ||
        loaded.spaceId !== spaceId ||
        !latestSource ||
        activeNavigationEntry(latestSource.tab).id !== sourceEntryId ||
        workspaceLocationKey(activeLocation(latestSource.tab)) !== sourceKey
      )
        throw new Error('REFERENCE_TARGET_CHANGED');
      if (live) {
        if (latest.sessions?.find(spaceId, request.target.source.id) !== live)
          throw new Error('REFERENCE_TARGET_CHANGED');
        loaded.blockId = liveReferenceLocation(live, request.target, request.referenceId);
      }
      latest.workspace.navigateReference(tabId, loaded.article.id, loaded.blockId, request);
      latest.setData((data) =>
        data?.spaceId === spaceId
          ? {
              ...data,
              articles: [
                ...(data.articles ?? []).filter((article) => article.id !== loaded.article.id),
                loaded.article,
              ],
            }
          : data,
      );
      latest.overlays.forEach((close) => close(false));
    };
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request = event.detail as ReferenceNavigationRequest;
      if (typeof request?.accept !== 'function') return;
      event.preventDefault();
      request.accept(navigate(request));
    };
    window.addEventListener(REFERENCE_NAVIGATION_EVENT, listener);
    window.addEventListener(ARTICLE_CREATED_EVENT, articleCreated);
    return () => {
      epoch++;
      window.removeEventListener(REFERENCE_NAVIGATION_EVENT, listener);
      window.removeEventListener(ARTICLE_CREATED_EVENT, articleCreated);
    };
  }, []);
}

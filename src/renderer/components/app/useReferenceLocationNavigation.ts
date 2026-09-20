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

export function useReferenceLocationNavigation(
  data: Pick<BootstrapDto, 'spaceId'> | null,
  workspace: ReturnType<typeof useWorkspaceController>,
  setData: Dispatch<SetStateAction<BootstrapDto | null>>,
  flushers: { current: Map<string, () => void> },
  overlays: readonly Dispatch<SetStateAction<boolean>>[],
) {
  const options = { spaceId: data?.spaceId, workspace, setData, flushers, overlays };
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    let epoch = 0;
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
      const loaded = await contentLibraryApi().referenceOpen(
        referenceTargetSchema.parse(request.target),
        request.referenceId,
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
    return () => {
      epoch++;
      window.removeEventListener(REFERENCE_NAVIGATION_EVENT, listener);
    };
  }, []);
}

import { useEffect, useRef } from 'react';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import type { ReferenceTarget } from '@/shared/contracts/content-source';

export const REFERENCE_NAVIGATION_EVENT = 'aiy:reference-navigation';
export interface ReferenceNavigationRequest {
  target: ReferenceTarget;
  referenceId?: string;
  sourceTabId: string;
  originArticleId?: string;
  originBlockId?: string;
  beside: boolean;
  isCurrent(): boolean;
  accept(operation: Promise<void>): void;
}

export function useReferenceNavigation(originBlockId?: string, enabled = true) {
  const host = useContentReferenceHost();
  const { tabId } = useWorkspaceArticleEditorState(host.source?.id ?? '');
  const epoch = useRef(0);
  const available = useRef(enabled);
  available.current = enabled;
  useEffect(
    () => () => {
      epoch.current++;
    },
    [enabled, originBlockId, host.source?.kind, host.source?.id],
  );
  return async (target: ReferenceTarget, options: { beside?: boolean; referenceId?: string } = {}) => {
    if (!tabId) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
    const generation = epoch.current;
    const isCurrent = () => available.current && generation === epoch.current;
    if (host.beforeCapture && !(await host.beforeCapture())) throw new Error('REFERENCE_SAVE_FAILED');
    if (!isCurrent()) throw new Error('REFERENCE_TARGET_CHANGED');
    return new Promise<void>((resolve, reject) => {
      const request: ReferenceNavigationRequest = {
        target,
        referenceId: options.referenceId,
        sourceTabId: tabId,
        originArticleId: host.source?.kind === 'ARTICLE' ? host.source.id : undefined,
        originBlockId,
        beside: options.beside ?? false,
        isCurrent,
        accept: (operation) => {
          void operation.then(resolve, reject);
        },
      };
      const handled = !window.dispatchEvent(
        new CustomEvent(REFERENCE_NAVIGATION_EVENT, { detail: request, cancelable: true }),
      );
      if (!handled) reject(new Error('REFERENCE_NAVIGATION_UNSUPPORTED'));
    });
  };
}

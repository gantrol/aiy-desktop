import { useCallback, type RefObject } from 'react';
import type { Locale } from '@/shared/contracts';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import {
  findWorkspaceTab,
  openWorkspaceTab,
  openWorkspaceTabBeside,
  type WorkspaceRuntimeState,
} from '@/renderer/components/workspace/workspace-state';

type UpdateWorkspace = (operation: (current: WorkspaceRuntimeState) => WorkspaceRuntimeState) => void;

export function useWorkspaceTabOpening(
  stateRef: RefObject<WorkspaceRuntimeState | null>,
  contextRef: RefObject<object | null>,
  update: UpdateWorkspace,
) {
  const openTab = useCallback(
    (location: AppLocation, groupId?: string) => update((current) => openWorkspaceTab(current, location, groupId)),
    [update],
  );
  const openBeside = useCallback(
    (sourceTabId: string, location: AppLocation) =>
      update((current) => openWorkspaceTabBeside(current, sourceTabId, location)),
    [update],
  );
  const openLocation = useCallback(
    async (
      sourceTabId: string,
      destination: AppLocation['view'] | AppLocation,
      placement: 'tab' | 'beside',
      termPromptLocale: Locale,
    ) => {
      const state = stateRef.current;
      const context = contextRef.current;
      if (!state || !context || !findWorkspaceTab(state, sourceTabId)) return;
      let location: AppLocation;
      if (destination === 'creator') {
        // Allocate the new editor's identity before deduplication can resume an existing draft.
        const draft = await window.desktopApi.creationDraftStart({ albumId: null, termPromptLocale });
        if (contextRef.current !== context) return;
        location = { ...initialAppLocation, creator: { surface: 'creation-draft', draftId: draft.id } };
      } else {
        location = typeof destination === 'string' ? { ...initialAppLocation, view: destination } : destination;
      }
      update((current) => {
        const source = findWorkspaceTab(current, sourceTabId);
        if (!source || current.spaceId !== state.spaceId) return current;
        return placement === 'beside'
          ? openWorkspaceTabBeside(current, sourceTabId, location)
          : openWorkspaceTab(current, location, source.group.id);
      });
    },
    [contextRef, stateRef, update],
  );

  return { openTab, openBeside, openLocation };
}

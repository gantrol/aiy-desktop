import { useEffect, useLayoutEffect, useRef } from 'react';
import type {
  CreationDraftDto,
  CreationDraftStartInput,
  CreatorAgentScope,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
} from '@/shared/contracts';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { CreationStartMode } from '@/shared/contracts/creation-draft';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import {
  navigationLocationKey,
  type CreatorLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { isCreationDraftSessionSupersededError } from '@/renderer/components/creator/workflows/creationDraftSessionErrors';
import { isCreationDraftConflict, isCreationDraftUnavailable } from '@/shared/creation-draft-errors';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { MessageCatalog } from '@/renderer/i18n/types';

type CreationMode = 'existing' | 'new';

interface Options {
  active: boolean;
  albumTree: AlbumTreeIndex;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationDraftId: string | null;
  creationMode: CreationMode;
  creationSessions: readonly CreationSessionProjection[];
  defaultPromptLocale: Locale | null;
  draftMessages: Pick<MessageCatalog['creator']['draftConflict'], 'movedToRoot' | 'moveFailed' | 'unavailable'>;
  detachDraftIdentity(): void;
  hasPendingInput(): boolean;
  hydratedVersionId: string | null;
  getSavedDraft(): CreationDraftDto | null;
  isDraftInputSaved(): boolean;
  invalidateAutosaves(): void;
  locale: Locale;
  location: CreatorLocation;
  manualPrompt: string;
  meaningfulDraftInput: boolean;
  newTitle: string;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  preserveWorkingInput(): Promise<boolean>;
  referenceAssetCount: number;
  resetInputs(): void;
  restoreAssistant(scope: CreatorAgentScope | null): void;
  restoreDraft(draft: CreationDraftDto | null): void;
  restoreVersion(version: PromptVersionDto | undefined): void;
  saveDraft(albumId?: string | null): Promise<unknown>;
  selectedContent: boolean;
  startNewSaveBlocked: boolean;
  selectedTermCount: number;
  selectedAlbumId: string | null;
  series: readonly PromptSeriesDto[];
  seriesId: string | null;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setCreationMode(mode: CreationMode): void;
  setDictionaryScope(scope: ReturnType<typeof emptyCreationDictionaryScope>): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: 'results'): void;
  setOutputSeriesId(id: string | null): void;
  setRequestedAssetId(id: string | null): void;
  setSeriesId(id: string | null): void;
  setTargetAlbumId(id: string | null): void;
  setVersionId(id: string): void;
  setVideoCreationRequest(value: null): void;
  startNewSession(albumId: string | null): void;
  targetAlbumId: string | null;
  targetAlbumUnavailable: boolean;
}

interface CreationNavigationContext {
  active: boolean;
  location: CreatorLocation;
  draftId: string | null;
}

function creationNavigationContextChanged(previous: CreationNavigationContext, current: CreationNavigationContext) {
  const assignedDraftLocation =
    previous.location.surface === 'new-creation' &&
    current.location.surface === 'creation-draft' &&
    current.location.draftId === current.draftId &&
    (!previous.draftId || previous.draftId === current.draftId);
  return (
    previous.active !== current.active ||
    Boolean(previous.draftId && previous.draftId !== current.draftId) ||
    (!assignedDraftLocation && navigationLocationKey(previous.location) !== navigationLocationKey(current.location))
  );
}

function prepareDraftWorkspace(options: Options) {
  options.onComparisonFullWindowChange(false);
  options.clearSelection();
  options.clearSavedInspiration();
  options.setOutputMode('results');
  options.setVideoCreationRequest(null);
  options.setCreationMode('new');
  options.setSeriesId(null);
  options.setOutputSeriesId(null);
  options.setVersionId('');
  options.setRequestedAssetId(null);
  options.setOutputGalleryOpen(false);
  options.setCompactPanel('creator');
}

function replaceWithBlankSession(options: Options, albumId: string | null) {
  options.invalidateAutosaves();
  prepareDraftWorkspace(options);
  options.resetInputs();
  options.startNewSession(albumId);
  options.restoreAssistant(null);
}

function prepareResumedDraftWorkspace(options: Options, draftId: string, hasDraftState: boolean) {
  const initializesEmptyEditor =
    options.location.surface === 'creation-draft' &&
    options.location.draftId === draftId &&
    options.creationMode === 'new' &&
    !options.selectedContent &&
    !options.seriesId &&
    !hasDraftState;
  // A new tab already owns an empty editor. Hydrate it in place; only switching
  // away from an existing input session needs a new editor and undo history.
  if (initializesEmptyEditor) {
    options.invalidateAutosaves();
    prepareDraftWorkspace(options);
  } else {
    replaceWithBlankSession(options, null);
  }
}

export function useCreatorCreationNavigation(options: Options) {
  const commandRevisionRef = useRef(0);
  const contextRef = useRef({
    active: options.active,
    location: options.location,
    draftId: options.creationDraftId,
  });
  useLayoutEffect(() => {
    const current = { active: options.active, location: options.location, draftId: options.creationDraftId };
    if (creationNavigationContextChanged(contextRef.current, current)) commandRevisionRef.current += 1;
    contextRef.current = current;
  }, [options.active, options.creationDraftId, options.location]);
  useLayoutEffect(
    () => () => {
      commandRevisionRef.current += 1;
    },
    [],
  );
  const { commit, creationMode, location, notify, saveDraft, setTargetAlbumId, targetAlbumId, targetAlbumUnavailable } =
    options;
  const hasDraftState = useStableCallback(() =>
    Boolean(options.creationDraftId || options.meaningfulDraftInput || options.hasPendingInput()),
  );

  const saveCurrentDraft = useStableCallback(async () => {
    const commandRevision = commandRevisionRef.current;
    try {
      while (options.hasPendingInput() || !options.isDraftInputSaved()) {
        await options.saveDraft();
        if (commandRevisionRef.current !== commandRevision) return false;
      }
      return true;
    } catch (reason) {
      if (!isCreationDraftSessionSupersededError(reason) && !isCreationDraftConflict(reason))
        options.notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  });
  const preserveWorkingDraft = useStableCallback(async () => {
    const commandRevision = commandRevisionRef.current;
    if (!(await options.preserveWorkingInput())) return false;
    if (commandRevisionRef.current !== commandRevision) return false;
    if (options.selectedContent || options.creationMode !== 'new' || !hasDraftState()) return true;
    return saveCurrentDraft();
  });
  const preserveBeforeNavigation = useStableCallback(async () => {
    commandRevisionRef.current += 1;
    return preserveWorkingDraft();
  });

  async function preserveCurrentDraft() {
    if (options.startNewSaveBlocked || options.creationMode !== 'new' || !hasDraftState()) return true;
    return saveCurrentDraft();
  }

  const startNewCreation = useStableCallback(
    async (
      albumId: string | null = null,
      mode: NavigationMode | null = 'push',
      preserveCurrent = true,
      startMode: CreationStartMode = 'manuscript',
      materials: Pick<CreationDraftStartInput, 'referenceAssetIds' | 'videoMaterialIds' | 'creationSource'> = {},
    ) => {
      const commandRevision = ++commandRevisionRef.current;
      if (!(await options.preserveWorkingInput())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      if (preserveCurrent && !(await preserveCurrentDraft())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      let draft: CreationDraftDto;
      try {
        draft = await window.desktopApi.creationDraftStart({
          albumId,
          termPromptLocale: options.defaultPromptLocale ?? options.locale,
          startMode,
          ...materials,
        });
      } catch (reason) {
        options.notify(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
      if (commandRevisionRef.current !== commandRevision) return false;
      // The current editor stays usable while the next draft is being created.
      // Preserve any input made during that request before replacing it.
      if (!(await options.preserveWorkingInput())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      if (preserveCurrent && !(await preserveCurrentDraft())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      replaceWithBlankSession(options, albumId);
      options.restoreDraft(draft);
      if (mode) {
        const nextLocation = { surface: 'new-creation' as const, albumId };
        options.commit(nextLocation, mode);
      }
      return true;
    },
  );

  const resumeCreationDraft = useStableCallback(async (draftId: string, mode: NavigationMode | null = 'push') => {
    const commandRevision = ++commandRevisionRef.current;
    if (!(await options.preserveWorkingInput())) return false;
    if (commandRevisionRef.current !== commandRevision) return false;
    if (!(await preserveCurrentDraft())) return false;
    if (commandRevisionRef.current !== commandRevision) return false;
    try {
      let draft = await window.desktopApi.creationDraftLoad({ draftId });
      if (commandRevisionRef.current !== commandRevision) return false;
      if (!(await options.preserveWorkingInput())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      if (!(await preserveCurrentDraft())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      const savedDraft = options.getSavedDraft();
      if (options.creationDraftId === draftId && savedDraft?.id === draftId && savedDraft.updatedAt > draft.updatedAt)
        draft = savedDraft;
      prepareResumedDraftWorkspace(options, draftId, hasDraftState());
      if (mode) {
        const nextLocation = { surface: 'creation-draft' as const, draftId };
        options.commit(nextLocation, mode);
      }
      options.restoreDraft(draft);
      options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
      return true;
    } catch (reason) {
      if (commandRevisionRef.current === commandRevision) {
        options.notify(
          isCreationDraftUnavailable(reason)
            ? options.draftMessages.unavailable
            : reason instanceof Error
              ? reason.message
              : String(reason),
        );
      }
      return false;
    }
  });

  const discardDeletedDraft = useStableCallback((draftIds: string[]) => {
    if (!options.creationDraftId || !draftIds.includes(options.creationDraftId)) return;
    if (options.creationMode !== 'new' || options.selectedContent) {
      options.detachDraftIdentity();
      return;
    }
    commandRevisionRef.current += 1;
    replaceWithBlankSession(options, options.targetAlbumId);
    options.commit({ surface: 'new-creation', albumId: options.targetAlbumId }, 'replace');
  });

  const continueSavedDraft = useStableCallback((draft: CreationDraftDto) => {
    if (options.getSavedDraft()?.id !== draft.id) return;
    commandRevisionRef.current += 1;
    prepareDraftWorkspace(options);
    options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
    // The save session already owns this copy. Keep input typed during its save;
    // loading it again would add a failure point and replace those newer edits.
    options.commit({ surface: 'creation-draft', draftId: draft.id }, 'replace');
  });

  const detachDraftFromUnavailableAlbum = useStableCallback(async (albumId: string, includeDescendants: boolean) => {
    if (options.selectedContent || options.creationMode !== 'new' || !options.targetAlbumId) return false;
    let affected = options.targetAlbumId === albumId;
    if (!affected && includeDescendants) {
      const visited = new Set<string>();
      let currentAlbumId: string | undefined = options.targetAlbumId;
      while (currentAlbumId && !visited.has(currentAlbumId)) {
        visited.add(currentAlbumId);
        currentAlbumId = options.albumTree.parentById.get(currentAlbumId);
        if (currentAlbumId === albumId) {
          affected = true;
          break;
        }
      }
    }
    if (!affected) return false;
    options.setTargetAlbumId(null);
    try {
      await options.saveDraft(null);
    } catch (reason) {
      options.notify(
        options.draftMessages.moveFailed.replace('{error}', reason instanceof Error ? reason.message : String(reason)),
      );
    }
    if (options.location.surface === 'new-creation') {
      options.commit({ surface: 'new-creation', albumId: null }, 'replace');
    }
    return true;
  });

  useEffect(() => {
    if (options.selectedContent || creationMode !== 'new' || !targetAlbumId || !targetAlbumUnavailable) return;
    setTargetAlbumId(null);
    if (location.surface === 'new-creation') {
      commit({ surface: 'new-creation', albumId: null }, 'replace');
    }
    void saveDraft(null)
      .then(() => notify(options.draftMessages.movedToRoot))
      .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
  }, [
    commit,
    creationMode,
    options.draftMessages,
    location.surface,
    notify,
    options.selectedContent,
    saveDraft,
    setTargetAlbumId,
    targetAlbumId,
    targetAlbumUnavailable,
  ]);

  const chooseSeries = useStableCallback(
    async (id: string, assetId?: string, mode: NavigationMode | null = 'push', requestedVersionId?: string) => {
      const commandRevision = ++commandRevisionRef.current;
      if (!(await preserveWorkingDraft())) return false;
      if (commandRevisionRef.current !== commandRevision) return false;
      const targetSeries = options.series.find((item) => item.id === id);
      if (!targetSeries) return false;
      const targetVersion =
        targetSeries.versions.find((item) => item.id === requestedVersionId) ??
        targetSeries.versions.find((item) => item.id === targetSeries.currentVersionId) ??
        targetSeries.versions[0];
      const changed =
        options.creationMode !== 'existing' || options.seriesId !== id || options.selectedAlbumId !== null;
      options.onComparisonFullWindowChange(false);
      options.clearSelection();
      options.clearSavedInspiration();
      options.setOutputMode('results');
      options.setTargetAlbumId(null);
      options.setCreationMode('existing');
      options.setSeriesId(id);
      options.setOutputSeriesId(id);
      options.detachDraftIdentity();
      options.setRequestedAssetId(assetId ?? null);
      if (assetId) options.setOutputCollapsed(false);
      options.setOutputGalleryOpen(false);
      // A route may name the current version just to select another result.
      // Rehydrating it would replace the working input with its frozen references.
      if (changed || (requestedVersionId && targetVersion?.id !== options.hydratedVersionId)) {
        options.setDictionaryScope(emptyCreationDictionaryScope());
        options.setVersionId(targetVersion?.id ?? '');
        options.resetInputs();
        options.restoreVersion(targetVersion);
      }
      const session = options.creationSessions.find((item) => item.memberSeries.some((member) => member.id === id));
      if (changed) options.restoreAssistant({ kind: 'SERIES', id: session?.primarySeries.id ?? id });
      options.setCompactPanel(assetId ? 'output' : 'creator');
      if (mode) options.commit({ surface: 'existing-creation', seriesId: id, assetId: assetId ?? null }, mode);
      return true;
    },
  );

  return {
    chooseSeries,
    continueSavedDraft,
    detachDraftFromUnavailableAlbum,
    discardDeletedDraft,
    hasDraftState,
    preserveBeforeNavigation,
    resumeCreationDraft,
    startNewCreation,
  };
}

import { useEffect, useLayoutEffect, useRef } from 'react';
import type {
  CreationDraftDto,
  CreatorAgentScope,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
} from '@/shared/contracts';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import {
  navigationLocationKey,
  type CreatorLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { isCreationDraftSessionSupersededError } from '@/renderer/components/creator/workflows/useCreationDraftSession';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

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
  detachDraftIdentity(): void;
  hasPendingInput(): boolean;
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
  const {
    commit,
    creationMode,
    locale,
    location,
    notify,
    saveDraft,
    setTargetAlbumId,
    targetAlbumId,
    targetAlbumUnavailable,
  } = options;
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
      if (!isCreationDraftSessionSupersededError(reason))
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

  function replaceWithBlankSession(albumId: string | null) {
    options.invalidateAutosaves();
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
    options.resetInputs();
    options.startNewSession(albumId);
    options.restoreAssistant(null);
  }

  async function preserveCurrentDraft() {
    if (options.startNewSaveBlocked || options.creationMode !== 'new' || !hasDraftState()) return true;
    return saveCurrentDraft();
  }

  const startNewCreation = useStableCallback(
    async (albumId: string | null = null, mode: NavigationMode | null = 'push', preserveCurrent = true) => {
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
      replaceWithBlankSession(albumId);
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
      if (options.creationDraftId === draftId && savedDraft?.id === draftId) draft = savedDraft;
      replaceWithBlankSession(null);
      if (mode) {
        const nextLocation = { surface: 'creation-draft' as const, draftId };
        options.commit(nextLocation, mode);
      }
      options.restoreDraft(draft);
      options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
      return true;
    } catch (reason) {
      if (commandRevisionRef.current === commandRevision) {
        options.notify(reason instanceof Error ? reason.message : String(reason));
      }
      return false;
    }
  });

  const detachDraftFromUnavailableAlbum = useStableCallback(async (albumId: string, includeDescendants: boolean) => {
    if (options.creationMode !== 'new' || !options.targetAlbumId) return false;
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
        options.locale === 'zh'
          ? `草稿已移到顶层，但自动保存失败：${reason instanceof Error ? reason.message : String(reason)}`
          : `The draft was moved to the root, but autosave failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
    if (options.location.surface === 'new-creation') {
      options.commit({ surface: 'new-creation', albumId: null }, 'replace');
    }
    return true;
  });

  useEffect(() => {
    if (creationMode !== 'new' || !targetAlbumId || !targetAlbumUnavailable) return;
    setTargetAlbumId(null);
    if (location.surface === 'new-creation') {
      commit({ surface: 'new-creation', albumId: null }, 'replace');
    }
    void saveDraft(null)
      .then(() =>
        notify(
          locale === 'zh'
            ? '目标图集不可用，草稿已移到顶层'
            : 'The target album is unavailable; the draft was moved to the root',
        ),
      )
      .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
  }, [
    commit,
    creationMode,
    locale,
    location.surface,
    notify,
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
      if (changed || requestedVersionId) {
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
    detachDraftFromUnavailableAlbum,
    hasDraftState,
    preserveBeforeNavigation,
    resumeCreationDraft,
    startNewCreation,
  };
}

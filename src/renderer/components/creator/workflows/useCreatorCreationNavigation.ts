import { useEffect, useRef } from 'react';
import type {
  CreationDraftDto,
  CreatorAgentScope,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
} from '@/shared/contracts';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import type { CreationDraftSaveSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type CreationMode = 'existing' | 'new';

interface Options {
  albumTree: AlbumTreeIndex;
  captureDraft(): CreationDraftSaveSnapshot;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationDraftId: string | null;
  creationMode: CreationMode;
  creationSessions: readonly CreationSessionProjection[];
  defaultPromptLocale: Locale | null;
  detachDraftIdentity(): void;
  invalidateAutosaves(): void;
  locale: Locale;
  location: CreatorLocation;
  manualPrompt: string;
  meaningfulDraftInput: boolean;
  newTitle: string;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  preserveCapturedDraft(snapshot: CreationDraftSaveSnapshot): Promise<unknown>;
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

export function useCreatorCreationNavigation(options: Options) {
  const commandRevisionRef = useRef(0);
  const locationRef = useRef(options.location);
  locationRef.current = options.location;
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
  const hasDraftState = useStableCallback(() => Boolean(options.creationDraftId || options.meaningfulDraftInput));

  const preserveBeforeNavigation = useStableCallback(async () => {
    if (options.selectedContent || options.creationMode !== 'new' || !hasDraftState()) return true;
    try {
      await options.saveDraft();
      return true;
    } catch (reason) {
      options.notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
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
    if (options.startNewSaveBlocked || options.creationMode !== 'new' || !hasDraftState()) return;
    try {
      await options.preserveCapturedDraft(options.captureDraft());
    } catch (reason) {
      options.notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const startNewCreation = useStableCallback(
    async (albumId: string | null = null, mode: NavigationMode | null = 'push', preserveCurrent = true) => {
      const commandRevision = ++commandRevisionRef.current;
      if (preserveCurrent) await preserveCurrentDraft();
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
      replaceWithBlankSession(albumId);
      options.restoreDraft(draft);
      if (mode) {
        const nextLocation = { surface: 'new-creation' as const, albumId };
        locationRef.current = nextLocation;
        options.commit(nextLocation, mode);
      }
      return true;
    },
  );

  const resumeCreationDraft = useStableCallback(async (draftId: string, mode: NavigationMode | null = 'push') => {
    const commandRevision = ++commandRevisionRef.current;
    if (options.creationDraftId !== draftId) void preserveCurrentDraft();
    replaceWithBlankSession(null);
    if (mode) {
      const nextLocation = { surface: 'creation-draft' as const, draftId };
      locationRef.current = nextLocation;
      options.commit(nextLocation, mode);
    }
    try {
      const draft = await window.desktopApi.creationDraftLoad({ draftId });
      const currentLocation = locationRef.current;
      if (
        commandRevisionRef.current !== commandRevision ||
        currentLocation.surface !== 'creation-draft' ||
        currentLocation.draftId !== draftId
      ) {
        return false;
      }
      options.restoreDraft(draft);
      options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
      return true;
    } catch (reason) {
      const currentLocation = locationRef.current;
      if (
        commandRevisionRef.current === commandRevision &&
        currentLocation.surface === 'creation-draft' &&
        currentLocation.draftId === draftId
      ) {
        options.notify(reason instanceof Error ? reason.message : String(reason));
        const fallbackLocation = { surface: 'new-creation' as const, albumId: null };
        locationRef.current = fallbackLocation;
        options.commit(fallbackLocation, 'replace');
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
      commandRevisionRef.current += 1;
      if (!(await preserveBeforeNavigation())) return false;
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

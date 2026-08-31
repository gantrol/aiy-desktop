import type {
  AssistantWebSearchMode,
  CreationDto,
  CreationDraftDto,
  CreatorAgentScope,
  PromptSeriesDto,
} from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type CreationMode = 'existing' | 'new';

interface Options {
  activeIdeaCreation: CreationDto | null;
  activeSessionSeries: readonly PromptSeriesDto[];
  chooseSeries(id: string, assetId?: string, mode?: NavigationMode | null): Promise<boolean>;
  clearAssistantError(): void;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationDraft: CreationDraftDto | null;
  creationDraftId: string | null;
  creationMode: CreationMode;
  creations: readonly CreationDto[] | undefined;
  outputMode: CreationOutputMode;
  outputSeriesAvailable: boolean;
  preserveBeforeNavigation(): Promise<boolean>;
  rememberSavedDraft(draft: CreationDraftDto): void;
  requestAssistant(
    mode: 'directions' | 'optimize',
    creationId?: string,
    webSearchMode?: AssistantWebSearchMode,
  ): Promise<unknown>;
  requestedAssetId: string | null;
  restoreAssistant(scope: CreatorAgentScope): void;
  restoreDraft(draft: CreationDraftDto): void;
  selectedIdeaCreation: CreationDto | null;
  seriesId: string | null;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setCreationMode(mode: CreationMode): void;
  setIdeaCreation(id: string | null): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: CreationOutputMode): void;
  setOutputSeriesId(id: string | null): void;
  setRequestedAssetId(id: string | null): void;
  setSeriesId(id: string | null): void;
  setTargetAlbumId(id: string | null): void;
  targetAlbumId: string | null;
  onComparisonFullWindowChange(open: boolean): void;
  resetInputs(): void;
}

export function useCreatorIdeaNavigation(options: Options) {
  const chooseIdeaCreation = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const creation = (options.creations ?? []).find((item) => item.id === id);
    if (!creation || !(await options.preserveBeforeNavigation())) return false;
    options.onComparisonFullWindowChange(false);
    options.clearSelection();
    options.clearSavedInspiration();
    if (creation.sourceScope.kind === 'SERIES') {
      const sourceLoaded =
        options.creationMode === 'existing' &&
        (options.seriesId === creation.sourceScope.id ||
          options.activeSessionSeries.some((item) => item.id === creation.sourceScope.id));
      if (!sourceLoaded && !(await options.chooseSeries(creation.sourceScope.id, undefined, null))) return false;
    } else if (options.creationDraft?.id === creation.sourceScope.id) {
      const draftChanged = options.creationMode !== 'new' || options.creationDraftId !== options.creationDraft.id;
      options.setTargetAlbumId(options.creationDraft.targetAlbumId);
      options.setCreationMode('new');
      options.setSeriesId(null);
      options.setOutputSeriesId(null);
      options.rememberSavedDraft(options.creationDraft);
      if (draftChanged) {
        options.resetInputs();
        options.restoreDraft(options.creationDraft);
        options.restoreAssistant({ kind: 'DRAFT', id: options.creationDraft.id });
      }
    }
    options.setIdeaCreation(id);
    options.setOutputMode('records');
    options.setRequestedAssetId(null);
    options.setOutputGalleryOpen(false);
    options.setOutputCollapsed(false);
    options.setCompactPanel('output');
    if (mode) options.commit({ surface: 'idea-creation', creationId: id }, mode);
    return true;
  });

  const changeOutputMode = useStableCallback(async (nextMode: CreationOutputMode) => {
    if (nextMode !== options.outputMode) options.clearAssistantError();
    if (nextMode === 'records') {
      options.setOutputMode('records');
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
      return true;
    }
    const ideaSource = options.selectedIdeaCreation?.sourceScope;
    if (ideaSource?.kind === 'SERIES') {
      const sourceLoaded =
        options.creationMode === 'existing' &&
        (options.seriesId === ideaSource.id || options.activeSessionSeries.some((item) => item.id === ideaSource.id));
      if (!sourceLoaded) {
        if (!(await options.chooseSeries(ideaSource.id))) return false;
      } else {
        options.setIdeaCreation(null);
        if (options.seriesId) {
          options.commit(
            { surface: 'existing-creation', seriesId: options.seriesId, assetId: options.requestedAssetId },
            'push',
          );
        }
      }
    } else if (options.selectedIdeaCreation) {
      options.setIdeaCreation(null);
      if (options.creationMode === 'new') {
        options.commit(
          options.creationDraftId
            ? { surface: 'creation-draft', draftId: options.creationDraftId }
            : { surface: 'new-creation', albumId: options.targetAlbumId },
          'push',
        );
      }
    }
    options.setOutputMode(nextMode);
    if (options.outputSeriesAvailable) {
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
    } else options.setCompactPanel('creator');
    return true;
  });

  const requestProjectIdeas = useStableCallback(async () => {
    options.setOutputMode('records');
    options.setOutputCollapsed(false);
    options.setCompactPanel('output');
    if (options.activeIdeaCreation) {
      options.setIdeaCreation(options.activeIdeaCreation.id);
      options.commit({ surface: 'idea-creation', creationId: options.activeIdeaCreation.id }, 'push');
    }
    await options.requestAssistant('directions', options.activeIdeaCreation?.id);
  });

  const requestProjectWriting = useStableCallback(async (webSearchMode: AssistantWebSearchMode = 'DISABLED') => {
    if (!(await changeOutputMode('records'))) return;
    await options.requestAssistant('optimize', undefined, webSearchMode);
  });

  return { changeOutputMode, chooseIdeaCreation, requestProjectIdeas, requestProjectWriting };
}

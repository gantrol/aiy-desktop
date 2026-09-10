import type {
  ArticleDto,
  BootstrapDto,
  CanvasPresetDto,
  CreationDictionaryScopeDto,
  CreationDraftDto,
  CreatorPromptNodeInput,
  DerivedVisualDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  PromptVersionDto,
  SocialPostDto,
} from '@/shared/contracts';
import type { RefObject } from 'react';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { replaceCreatorPromptText } from '@/renderer/components/creator/creatorPromptDocument';
import {
  derivedVisualCanvasPresetKeys,
  derivedVisualWorkspaceVersion,
  DerivedVisualViewUnavailableError,
  type DerivedVisualWorkspaceViewState,
} from '@/renderer/components/creator/derivedVisualWorkspace';
import { allAssets } from '@/renderer/components/creator/utils';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: Pick<BootstrapDto, 'articles' | 'derivedVisualPrompts' | 'series' | 'socialPosts'>;
  editorDerivedVisual: DerivedVisualDto | null;
  locale: Locale;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  preserveParentSelection: boolean;
  promptNodesRef: RefObject<CreatorPromptNodeInput[]>;
  replaceDraftSession(draft: null): void;
  resetInputs(): void;
  restoreAssistant(scope: { kind: 'DRAFT'; id: string }): void;
  restoreDraft(draft: CreationDraftDto): void;
  restoreVersion(version: PromptVersionDto | undefined): void;
  selectedArticle: ArticleDto | null;
  selectedSocialPost: SocialPostDto | null;
  selectArticle(id: string): void;
  selectSocialPost(id: string): void;
  setCanvasPresetKey(key: string): void;
  setCompactPanel(panel: 'output'): void;
  setCreationMode(mode: 'existing' | 'new'): void;
  setDictionaryScope(scope: CreationDictionaryScopeDto): void;
  setDismissedDerivedVisualId(id: string | null): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: CreationOutputMode): void;
  setOutputSeriesId(id: string | null): void;
  setRequestedAssetId(id: string | null): void;
  setSeriesId(id: string | null): void;
  setTargetAlbumId(id: string | null): void;
  setVersionId(id: string): void;
  setVideoCreationRequest(value: null): void;
  updatePromptDocument(nodes: CreatorPromptNodeInput[]): void;
}

export function useDerivedVisualWorkspaceNavigation(options: Options) {
  const labels = useI18n().messages.creator.derivedVisual;
  const changePrompt = useStableCallback((prompt: string) => {
    options.updatePromptDocument(replaceCreatorPromptText(options.promptNodesRef.current, prompt));
  });

  const openDraftWorkspace = useStableCallback(
    (draft: CreationDraftDto, visual?: DerivedVisualDto, view?: DerivedVisualWorkspaceViewState) => {
      if (
        visual &&
        !(visual.articleId
          ? options.data.articles?.some((article) => article.id === visual.articleId)
          : options.data.socialPosts?.some((post) => post.id === visual.socialPostId))
      )
        throw new Error(labels.parentUnavailable);
      options.onComparisonFullWindowChange(false);
      if (!options.preserveParentSelection) options.clearSelection();
      if (visual?.articleId) options.selectArticle(visual.articleId);
      else if (visual?.socialPostId) options.selectSocialPost(visual.socialPostId);
      options.clearSavedInspiration();
      options.setOutputMode('results');
      options.setVideoCreationRequest(null);
      options.setCreationMode('new');
      options.setSeriesId(null);
      options.setOutputSeriesId(null);
      options.setVersionId('');
      options.setRequestedAssetId(null);
      options.setOutputGalleryOpen(false);
      options.resetInputs();
      options.restoreDraft(draft);
      options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
      options.setDismissedDerivedVisualId(null);
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
      if (visual)
        options.commit(
          { surface: 'creation-draft', draftId: draft.id, derivedVisualId: visual.id },
          view?.navigationMode ?? 'push',
        );
    },
  );

  const openSeriesWorkspace = useStableCallback(
    (
      visual: DerivedVisualDto,
      hostSeriesId: string,
      workspace: DerivedVisualWorkspaceViewState & {
        prompt?: string;
        canvasPreset?: CanvasPresetDto;
      } = {},
    ) => {
      const hostSeries = options.data.series.find((candidate) => candidate.id === hostSeriesId);
      if (!hostSeries || visual.promptSeriesId !== hostSeries.id) {
        throw new Error(labels.workspaceUnavailable);
      }
      const targetVersion = derivedVisualWorkspaceVersion(hostSeries, workspace.versionId);
      if (!targetVersion) {
        if (workspace.versionId) throw new DerivedVisualViewUnavailableError(labels.savedVersionUnavailable);
        throw new Error(labels.workspaceUnavailable);
      }
      const outputSeries = workspace.outputSeriesId
        ? options.data.series.find((item) => item.id === workspace.outputSeriesId)
        : hostSeries;
      if (!outputSeries) throw new DerivedVisualViewUnavailableError(labels.savedOutputUnavailable);
      if (workspace.assetId && !allAssets(outputSeries).some((asset) => asset.id === workspace.assetId))
        throw new DerivedVisualViewUnavailableError(labels.savedCandidateUnavailable);
      const targetArticle = visual.articleId
        ? (options.data.articles ?? []).find((article) => article.id === visual.articleId)
        : null;
      const targetPost = visual.socialPostId
        ? (options.data.socialPosts ?? []).find((post) => post.id === visual.socialPostId)
        : null;
      if (!targetArticle && !targetPost) {
        throw new Error(labels.parentUnavailable);
      }
      options.replaceDraftSession(null);
      options.onComparisonFullWindowChange(false);
      if (targetArticle) options.selectArticle(targetArticle.id);
      else if (targetPost) options.selectSocialPost(targetPost.id);
      options.clearSavedInspiration();
      options.setTargetAlbumId(null);
      options.setOutputMode('results');
      options.setVideoCreationRequest(null);
      options.setCreationMode('existing');
      options.setSeriesId(hostSeries.id);
      options.setOutputSeriesId(workspace.outputSeriesId ?? hostSeries.id);
      options.setVersionId(targetVersion.id);
      options.setRequestedAssetId(workspace.assetId ?? null);
      options.setOutputGalleryOpen(false);
      options.setDictionaryScope(emptyCreationDictionaryScope());
      options.resetInputs();
      options.restoreVersion(targetVersion);
      if (workspace.canvasPreset) options.setCanvasPresetKey(workspace.canvasPreset.stableKey);
      if (workspace.prompt) changePrompt(workspace.prompt);
      options.setDismissedDerivedVisualId(null);
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
      options.commit(
        {
          surface: 'existing-creation',
          seriesId: hostSeries.id,
          ...(workspace.outputSeriesId && workspace.outputSeriesId !== hostSeries.id
            ? { outputSeriesId: workspace.outputSeriesId }
            : {}),
          versionId: targetVersion.id,
          assetId: workspace.assetId ?? null,
          derivedVisualId: visual.id,
        },
        workspace.navigationMode ?? 'push',
      );
    },
  );

  const openWorkspace = useStableCallback(
    (result: DerivedVisualWorkspaceOpenResult, view?: DerivedVisualWorkspaceViewState) => {
      if (result.kind === 'DRAFT') openDraftWorkspace(result.draft, result.visual, view);
      else
        openSeriesWorkspace(result.visual, result.seriesId, {
          assetId: result.visual.selectedImageAssetId ?? undefined,
          ...view,
        });
    },
  );

  const changeCanvas = useStableCallback((preset: CanvasPresetDto) => {
    const visual = options.editorDerivedVisual;
    if (!visual || !derivedVisualCanvasPresetKeys[visual.role].includes(preset.stableKey)) return;
    options.setCanvasPresetKey(preset.stableKey);
  });

  return { changeCanvas, changePrompt, openDraftWorkspace, openSeriesWorkspace, openWorkspace };
}

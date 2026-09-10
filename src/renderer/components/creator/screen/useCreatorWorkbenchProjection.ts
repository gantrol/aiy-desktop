import { useMemo, useState } from 'react';
import type {
  ArticleDto,
  BootstrapDto,
  CreatorAgentScope,
  DerivedVisualDto,
  Locale,
  SocialPostDto,
} from '@/shared/contracts';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { creationExperimentContextForSeries } from '@/renderer/components/creator/creationExperimentContext';
import { buildCreationOutputProjection } from '@/renderer/components/creator/creationOutputProjection';
import { derivedVisualCanvasPresetKeys } from '@/renderer/components/creator/derivedVisualWorkspace';
import { derivedVisualAppliedAssetId } from '@/shared/derived-visual-media';
import { derivedVisualSchemes } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { useI18n } from '@/renderer/i18n/useI18n';

type CreationMode = 'existing' | 'new';

interface Options {
  creationDraftId: string | null;
  creationMode: CreationMode;
  creationSessions: readonly CreationSessionProjection[];
  data: BootstrapDto;
  locale: Locale;
  selectedAlbumId: string | null;
  selectedArticle: ArticleDto | null;
  selectedArticleId: string | null;
  selectedEvaluationSuiteAlbumId: string | null;
  selectedEvaluationSuiteId: string | null;
  selectedIdeaCreationId: string | null;
  selectedImageBreakdownAlbumId: string | null;
  selectedImageBreakdownId: string | null;
  selectedSocialPost: SocialPostDto | null;
  selectedSocialPostId: string | null;
  seriesId: string | null;
  targetAlbumId: string | null;
}

function activeAlbumContext(options: Options, seriesAlbumId: string | null) {
  if (options.selectedEvaluationSuiteId) return options.selectedEvaluationSuiteAlbumId;
  if (options.selectedImageBreakdownId) return options.selectedImageBreakdownAlbumId;
  if (options.selectedSocialPostId) return options.selectedSocialPost?.albumId ?? null;
  if (options.selectedArticleId) return options.selectedArticle?.albumId ?? null;
  if (options.selectedIdeaCreationId) return null;
  return options.selectedAlbumId ?? (options.creationMode === 'new' ? options.targetAlbumId : seriesAlbumId);
}

function resolveAssistantScope(
  options: Options,
  sessionHostSeries: BootstrapDto['series'][number] | undefined,
  editingDerivedVisual: boolean,
): CreatorAgentScope | null {
  const contentSelected = Boolean(
    options.selectedEvaluationSuiteId ||
    options.selectedImageBreakdownId ||
    options.selectedSocialPostId ||
    options.selectedArticleId,
  );
  if (contentSelected && !editingDerivedVisual) return null;
  if (options.creationMode === 'existing' && sessionHostSeries) {
    return { kind: 'SERIES', id: sessionHostSeries.id };
  }
  return options.creationDraftId ? { kind: 'DRAFT', id: options.creationDraftId } : null;
}

function useOutputProjection(options: Options) {
  const [outputSeriesId, setOutputSeriesId] = useState<string | null>(options.seriesId);
  const outputSeries = options.data.series.find((item) => item.id === outputSeriesId);
  const outputCreationSession = outputSeries
    ? options.creationSessions.find((session) => session.memberSeries.some((item) => item.id === outputSeries.id))
    : undefined;
  const outputPrimarySeries = outputCreationSession?.primarySeries ?? outputSeries;
  const outputProjection = useMemo(
    () =>
      outputPrimarySeries
        ? buildCreationOutputProjection(outputPrimarySeries, options.data.series, options.data.styleExplorationBatches)
        : [],
    [options.data.series, options.data.styleExplorationBatches, outputPrimarySeries],
  );
  return { outputPrimarySeries, outputProjection, outputSeries, setOutputSeriesId };
}

function useDerivedVisualTarget(visual: DerivedVisualDto | null, data: BootstrapDto) {
  const article = (data.articles ?? []).find((item) => item.id === visual?.articleId);
  const post = (data.socialPosts ?? []).find((item) => item.id === visual?.socialPostId);
  const appliedAssetId = useMemo(() => derivedVisualAppliedAssetId(visual, article, post), [visual, article, post]);
  return {
    appliedDerivedVisualAssetId: appliedAssetId,
    appliedDerivedVisualAsset:
      (article?.content.mediaAssets ?? post?.content.mediaAssets ?? []).find((asset) => asset.id === appliedAssetId) ??
      null,
    derivedVisualTargetTitle: article?.content.title ?? post?.content.title,
    derivedVisualTargetRevisionId: article?.revisionId ?? post?.revisionId ?? null,
    derivedVisualTargetArticle: article ?? null,
  };
}

function useDerivedVisualProjection(options: Options, outputSeries: BootstrapDto['series'][number] | undefined) {
  const labels = useI18n().messages.creator.derivedVisual;
  const draftVisual =
    (options.data.derivedVisuals ?? []).find((visual) => visual.creationDraftId === options.creationDraftId) ?? null;
  const seriesVisual =
    (options.data.derivedVisuals ?? []).find((visual) => visual.promptSeriesId === options.seriesId) ?? null;
  const outputDerivedVisual =
    (options.data.derivedVisuals ?? []).find((visual) => visual.promptSeriesId === outputSeries?.id) ?? null;
  const activeDerivedVisual = options.creationMode === 'new' ? draftVisual : seriesVisual;
  const [dismissedId, setDismissedDerivedVisualId] = useState<string | null>(null);
  const belongsToSelectedContent = Boolean(
    (options.selectedArticle && activeDerivedVisual?.articleId === options.selectedArticle.id) ||
    (options.selectedSocialPost && activeDerivedVisual?.socialPostId === options.selectedSocialPost.id),
  );
  const editorDerivedVisual =
    activeDerivedVisual && activeDerivedVisual.id !== dismissedId && belongsToSelectedContent
      ? activeDerivedVisual
      : null;
  const schemes = derivedVisualSchemes(editorDerivedVisual, options.data);
  const target = useDerivedVisualTarget(editorDerivedVisual ?? outputDerivedVisual, options.data);
  return {
    ...target,
    activeDerivedVisual,
    editorDerivedVisual,
    editorDerivedVisualCanvasPresets: editorDerivedVisual
      ? options.data.canvasPresets.filter((preset) =>
          derivedVisualCanvasPresetKeys[editorDerivedVisual.role].includes(preset.stableKey),
        )
      : options.data.canvasPresets,
    editorDerivedVisualSchemeIndex: editorDerivedVisual
      ? schemes.findIndex((visual) => visual.id === editorDerivedVisual.id)
      : -1,
    editorDerivedVisualSchemes: schemes,
    editorDerivedVisualSourceAssets:
      options.selectedSocialPost?.content.mediaAssets ?? options.selectedArticle?.content.mediaAssets ?? [],
    editorDerivedVisualSourceTitle:
      options.selectedSocialPost?.content.title || options.selectedArticle?.content.title || labels.untitled,
    outputDerivedVisual,
    setDismissedDerivedVisualId,
  };
}

export function useCreatorWorkbenchProjection(options: Options) {
  const series =
    options.creationMode === 'existing' ? options.data.series.find((item) => item.id === options.seriesId) : undefined;
  const seriesAlbumId =
    options.data.creationItems.find((item) =>
      item.forms.some((form) => form.entity.kind === 'PROMPT_SERIES' && form.entity.id === options.seriesId),
    )?.albumId ?? null;
  const activeCreationSession = series
    ? options.creationSessions.find((session) => session.memberSeries.some((item) => item.id === series.id))
    : undefined;
  const sessionHostSeries = activeCreationSession?.primarySeries ?? series;
  const output = useOutputProjection(options);
  const derived = useDerivedVisualProjection(options, output.outputSeries);
  const seriesExperimentContext = useMemo(
    () => creationExperimentContextForSeries(series?.id, options.data.series, options.data.styleExplorationBatches),
    [options.data.series, options.data.styleExplorationBatches, series?.id],
  );

  return {
    ...derived,
    ...output,
    activeAlbumContextId: activeAlbumContext(options, seriesAlbumId),
    activeCreationSession,
    assistantScope: resolveAssistantScope(options, sessionHostSeries, Boolean(derived.editorDerivedVisual)),
    projectIdeaCreation: sessionHostSeries
      ? ((options.data.creations ?? []).find(
          (creation) =>
            creation.status !== 'ARCHIVED' &&
            creation.sourceScope.kind === 'SERIES' &&
            creation.sourceScope.id === sessionHostSeries.id,
        ) ?? null)
      : null,
    series,
    seriesExperimentContext,
    sessionHostSeries,
    viewingExperimentBranch: Boolean(series && sessionHostSeries && series.id !== sessionHostSeries.id),
  };
}

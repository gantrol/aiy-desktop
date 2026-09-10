import type {
  BootstrapDto,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
  StyleExplorationSlotDto,
} from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { allAssets } from '@/renderer/components/creator/utils';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  appendPromptText(text: string): void;
  chooseSeries(id: string, assetId?: string, mode?: NavigationMode | null, versionId?: string): Promise<boolean>;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationMode: 'existing' | 'new';
  data: BootstrapDto;
  locale: Locale;
  notify(message: string): void;
  preserveWorkingInput(): Promise<boolean>;
  restoreVersion(version: PromptVersionDto): void;
  selectedAlbumId: string | null;
  seriesId: string | null;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputSeriesId(id: string): void;
  setRenameOpen(open: boolean): void;
  setRequestedAssetId(id: string | null): void;
  setVersionId(id: string): void;
}

export function useCreatorOutputNavigation(options: Options) {
  const showMoreResults = useStableCallback(async (id: string) => {
    if (!(await options.chooseSeries(id))) return;
    options.setOutputCollapsed(false);
    options.setOutputGalleryOpen(true);
    options.setCompactPanel('output');
  });

  const applyImportedOutputs = useStableCallback((result: { seriesId: string; assetIds: string[] }) => {
    options.setOutputSeriesId(result.seriesId);
    options.setRequestedAssetId(result.assetIds[0] ?? null);
    options.setOutputGalleryOpen(false);
    options.setCompactPanel('output');
  });

  const pasteTextFromOutput = useStableCallback((text: string) => {
    options.appendPromptText(text);
    options.setCompactPanel('creator');
  });

  const requestSeriesRename = useStableCallback(async (series: PromptSeriesDto) => {
    if (await options.chooseSeries(series.id)) options.setRenameOpen(true);
  });

  const continueDirection = useStableCallback(async (slot: StyleExplorationSlotDto) => {
    if (!(await options.chooseSeries(slot.seriesId, undefined, 'push', slot.versionId))) return;
    options.notify(options.locale === 'zh' ? `继续方向 · ${slot.label}` : `Continuing direction · ${slot.label}`);
  });

  const openExplorationAsset = useStableCallback((assetId: string) => {
    const owner = options.data.series.find((item) => allAssets(item).some((asset) => asset.id === assetId));
    if (!owner) return;
    options.setOutputSeriesId(owner.id);
    options.setRequestedAssetId(assetId);
    options.setOutputGalleryOpen(false);
    options.setOutputCollapsed(false);
    options.setCompactPanel('output');
  });

  const reEditGeneration = useStableCallback(async (runId: string) => {
    const next = generationReEditLocation(options.data, runId, Date.now());
    if (!next || next.surface !== 'existing-creation') return;
    if (!(await options.chooseSeries(next.seriesId, next.assetId ?? undefined, null, next.versionId))) return;
    options.commit(next);
  });

  const reusePromptInput = useStableCallback(
    async (targetSeriesId: string, targetVersionId: string, annotationHistoryVersionId: string | null) => {
      const targetSeries = options.data.series.find((item) => item.id === targetSeriesId);
      const targetVersion = targetSeries?.versions.find((item) => item.id === targetVersionId);
      if (!targetSeries || !targetVersion) return null;
      if (!(await options.preserveWorkingInput())) return null;
      if (
        options.creationMode === 'existing' &&
        options.seriesId === targetSeriesId &&
        options.selectedAlbumId === null
      ) {
        options.setVersionId(targetVersion.id);
        options.restoreVersion(targetVersion);
      } else if (!(await options.chooseSeries(targetSeries.id, undefined, null, targetVersion.id))) return null;
      const reused = annotationHistoryVersionId
        ? await window.desktopApi.annotationsReuseHistory({ promptVersionId: annotationHistoryVersionId })
        : null;
      const assetId = reused?.imageAssetId ?? null;
      if (assetId) {
        options.setRequestedAssetId(assetId);
        options.setOutputGalleryOpen(false);
        options.setOutputCollapsed(false);
        options.setCompactPanel('output');
        options.commit({
          surface: 'existing-creation',
          seriesId: targetSeries.id,
          assetId,
          versionId: targetVersion.id,
          workspace: 'annotations',
          requestId: Date.now(),
        });
      } else options.setCompactPanel('creator');
      return { annotationsReused: Boolean(reused) };
    },
  );

  return {
    applyImportedOutputs,
    continueDirection,
    openExplorationAsset,
    pasteTextFromOutput,
    reEditGeneration,
    requestSeriesRename,
    reusePromptInput,
    showMoreResults,
  };
}

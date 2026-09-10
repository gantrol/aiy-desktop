import { useState } from 'react';
import type { Locale } from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { imageImportItems } from '@/renderer/components/creator/imageImport';
import type { NewExternalCreationDialogValue } from '@/renderer/components/creator/NewExternalCreationDialog';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationMode: 'existing' | 'new';
  hasDraftState(): boolean;
  importedMessage: string;
  locale: Locale;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  refresh(): Promise<void>;
  saveDraft(): Promise<unknown>;
  preserveWorkingInput(): Promise<boolean>;
  setCompactPanel(panel: 'output'): void;
  setCreationMode(mode: 'existing'): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: 'results'): void;
  setOutputSeriesId(id: string): void;
  setRequestedAssetId(id: string | null): void;
  setSeriesId(id: string): void;
  setTargetAlbumId(id: null): void;
  setVersionId(id: string): void;
}

export function useCreatorExternalCreationImport(options: Options) {
  const [dialogAlbumId, setDialogAlbumId] = useState<string | null | undefined>(undefined);
  const create = useStableCallback(async (value: NewExternalCreationDialogValue) => {
    if (!(await options.preserveWorkingInput())) return;
    if (options.creationMode === 'new' && options.hasDraftState()) await options.saveDraft();
    const outputItems = await imageImportItems(value.outputs.map((output) => output.file));
    const result = await window.desktopApi.creatorNewExternalCreationImport({
      intent: 'NEW_EXTERNAL_CREATION',
      sourceKind: 'EXTERNAL_IMPORT',
      creationDraftId: null,
      albumId: value.albumId,
      title: value.title,
      titleLocale: options.locale,
      prompt: value.promptKnowledge === 'EXACT' ? { knowledge: 'EXACT', text: value.prompt } : { knowledge: 'UNKNOWN' },
      source: value.source,
      sourceUrl: value.sourceUrl,
      outputs: outputItems.map((output, index) => ({ ...output, metadata: value.outputs[index]?.metadata })),
    });
    setDialogAlbumId(undefined);
    await options.refresh();
    if (!(await options.preserveWorkingInput())) return;
    const firstAssetId = result.assetIds[0] ?? null;
    options.onComparisonFullWindowChange(false);
    options.clearSelection();
    options.clearSavedInspiration();
    options.setOutputMode('results');
    options.setTargetAlbumId(null);
    options.setCreationMode('existing');
    options.setSeriesId(result.seriesId);
    options.setOutputSeriesId(result.seriesId);
    options.setVersionId(result.versionId);
    options.setRequestedAssetId(firstAssetId);
    options.setOutputGalleryOpen(false);
    options.setCompactPanel('output');
    options.commit({ surface: 'existing-creation', seriesId: result.seriesId, assetId: firstAssetId }, 'replace');
    options.notify(options.importedMessage);
    setDialogAlbumId(undefined);
  });
  return {
    createExternalCreation: create,
    externalCreationAlbumId: dialogAlbumId,
    externalCreationOpen: dialogAlbumId !== undefined,
    openExternalCreation: setDialogAlbumId,
  };
}

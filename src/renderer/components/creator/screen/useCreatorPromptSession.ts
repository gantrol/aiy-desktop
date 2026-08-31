import { useRef, useState } from 'react';
import type { BootstrapDto, CreationDraftDto, Locale, PromptSeriesDto } from '@/shared/contracts';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import {
  creatorPromptNodesFromCommonInput,
  creatorPromptNodesFromReferences,
} from '@/renderer/components/creator/creatorPromptDocument';
import { useCreatorDictionaryCatalog } from '@/renderer/components/creator/workflows/useCreatorDictionaryCatalog';
import { useCreatorPromptDocument } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import { appliedWordPalettesFromReferences } from '@/renderer/components/creator/utils';

interface Options {
  active: boolean;
  capturePersistedPaletteReferences: Parameters<
    typeof useCreatorPromptDocument
  >[0]['capturePersistedPaletteReferences'];
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  initialDraft: CreationDraftDto | null;
  loadDictionaryFailedMessage: string;
  locale: Locale;
  location: CreatorLocation;
  notify(message: string): void;
  series: PromptSeriesDto | undefined;
}

function initialVersionForLocation(series: PromptSeriesDto | undefined, location: CreatorLocation) {
  const requestedVersionId =
    location.surface === 'existing-creation' && location.seriesId === series?.id ? location.versionId : null;
  const versionId =
    requestedVersionId && series?.versions.some((item) => item.id === requestedVersionId)
      ? requestedVersionId
      : (series?.currentVersionId ?? '');
  return { version: series?.versions.find((item) => item.id === versionId), versionId };
}

function initialManualPrompt(
  draft: CreationDraftDto | null,
  version: PromptSeriesDto['versions'][number] | undefined,
  series: PromptSeriesDto | undefined,
) {
  return draft?.text ?? version?.manualPrompt ?? series?.versions[0]?.manualPrompt ?? '';
}

function initialTermIds(
  draft: CreationDraftDto | null,
  version: PromptSeriesDto['versions'][number] | undefined,
  series: PromptSeriesDto | undefined,
) {
  return draft?.termIds ?? version?.termIds ?? series?.versions[0]?.termIds ?? [];
}

function initialPaletteReferences(
  draft: CreationDraftDto | null,
  version: PromptSeriesDto['versions'][number] | undefined,
  series: PromptSeriesDto | undefined,
) {
  return (
    draft?.wordPaletteReferences ?? version?.wordPaletteReferences ?? series?.versions[0]?.wordPaletteReferences ?? []
  );
}

export function useCreatorPromptSession({
  active,
  capturePersistedPaletteReferences,
  data,
  defaultPromptLocale,
  initialDraft,
  loadDictionaryFailedMessage,
  locale,
  location,
  notify,
  series,
}: Options) {
  const { version: initialVersion, versionId: initialVersionId } = initialVersionForLocation(series, location);
  const [newTitle, setNewTitle] = useState(() => initialDraft?.title ?? '');
  const manualPrompt = initialManualPrompt(initialDraft, initialVersion, series);
  const termIds = initialTermIds(initialDraft, initialVersion, series);
  const wordPaletteReferences = initialPaletteReferences(initialDraft, initialVersion, series);
  const initialPromptNodes = creatorPromptNodesFromReferences({
    manualPrompt,
    termIds,
    wordPaletteReferences,
    nodes:
      initialDraft?.promptNodes ??
      creatorPromptNodesFromCommonInput(
        initialVersion?.promptInputSnapshot.commonInput ?? series?.versions[0]?.promptInputSnapshot.commonInput,
      ),
  });
  const newCreationVideoInputRef = useRef<HTMLInputElement>(null);
  const promptDocument = useCreatorPromptDocument({
    active,
    capturePersistedPaletteReferences,
    initial: {
      appliedPalettes: appliedWordPalettesFromReferences(data.wordPalettes, wordPaletteReferences),
      manualPrompt,
      promptNodes: initialPromptNodes,
      referenceAssets: initialDraft?.referenceAssets ?? [],
      selectedTerms: termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []),
      termPromptLocale:
        initialDraft?.termPromptLocale ?? initialVersion?.termPromptLocale ?? defaultPromptLocale ?? locale,
    },
    locale,
    palettes: data.wordPalettes,
    terms: data.terms,
  });
  const dictionaryCatalog = useCreatorDictionaryCatalog({
    active,
    data,
    initialScope: initialDraft?.dictionaryScope ?? emptyCreationDictionaryScope(),
    loadFailedMessage: loadDictionaryFailedMessage,
    locale,
    notify,
  });

  return {
    dictionaryCatalog,
    initialVersion,
    initialVersionId,
    newCreationVideoInputRef,
    newTitle,
    promptDocument,
    setNewTitle,
  };
}

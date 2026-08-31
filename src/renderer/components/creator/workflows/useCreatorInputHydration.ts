import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  BootstrapDto,
  AssetDto,
  CreationDictionaryScopeDto,
  CreationDraftDto,
  CreationInputStashDto,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
  CreatorPromptNodeInput,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import { emptyAlbumCreationDefaults, emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import {
  creatorPromptNodesFromCommonInput,
  creatorPromptNodesFromReferences,
} from '@/renderer/components/creator/creatorPromptDocument';
import {
  initialGenerationTargets,
  latestVersionGenerationRun,
  latestVersionGenerationTargets,
} from '@/renderer/components/creator/generationTargetDefaults';
import type { PromptDocumentReplacement } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import { appliedWordPalettesFromReferences } from '@/renderer/components/creator/utils';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type CreationMode = 'existing' | 'new';

interface Options {
  creationMode: CreationMode;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  initialVersionId: string;
  locale: Locale;
  locationVersionId: string | null;
  patchSavedDraftTitle(title: string): void;
  replaceDraftSession(draft: CreationDraftDto | null): void;
  replacePromptDocument(next: PromptDocumentReplacement): void;
  series: PromptSeriesDto | undefined;
  setCanvasPresetKey: Dispatch<SetStateAction<string>>;
  setDictionaryScope: Dispatch<SetStateAction<CreationDictionaryScopeDto>>;
  setGenerationTargets: Dispatch<SetStateAction<GenerationTargetInput[]>>;
  setNewTitle: Dispatch<SetStateAction<string>>;
  setTargetAlbumId: Dispatch<SetStateAction<string | null>>;
}

interface HydratedPromptSource {
  manualPrompt: string;
  promptNodes?: readonly CreatorPromptNodeInput[];
  referenceAssets: AssetDto[];
  termIds: string[];
  termPromptLocale: Locale;
  wordPaletteReferences: WordPaletteReferenceInput[];
}

function promptDocument(data: BootstrapDto, source: HydratedPromptSource): PromptDocumentReplacement {
  return {
    promptNodes: creatorPromptNodesFromReferences({
      manualPrompt: source.manualPrompt,
      termIds: source.termIds,
      wordPaletteReferences: source.wordPaletteReferences,
      nodes: source.promptNodes,
    }),
    referenceAssets: source.referenceAssets,
    selectedTerms: source.termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []),
    appliedPalettes: appliedWordPalettesFromReferences(data.wordPalettes, source.wordPaletteReferences),
    termPromptLocale: source.termPromptLocale,
  };
}

export function useCreatorInputHydration(options: Options) {
  const [versionId, setVersionId] = useState(options.initialVersionId);
  const [hydratedVersionId, setHydratedVersionId] = useState<string | null>(null);
  const restoredVersionIdRef = useRef<string | null>(null);
  const version = useMemo(
    () => options.series?.versions.find((item) => item.id === versionId),
    [options.series, versionId],
  );

  const restoreVersion = useStableCallback((next: PromptVersionDto | undefined) => {
    restoredVersionIdRef.current = next?.id ?? null;
    setHydratedVersionId(next?.id ?? null);
    if (!next) {
      options.replacePromptDocument({
        promptNodes: [],
        referenceAssets: [],
        selectedTerms: [],
        appliedPalettes: [],
        termPromptLocale: options.defaultPromptLocale ?? options.locale,
      });
      options.setCanvasPresetKey('');
      options.setGenerationTargets((current) => {
        const defaults = initialGenerationTargets({
          creationDraft: null,
          imageGenerationRoutes: options.data.imageGenerationRoutes,
        });
        return defaults.length ? defaults : current.map((target) => ({ ...target, quality: 'low' }));
      });
      return;
    }
    options.replacePromptDocument(
      promptDocument(options.data, {
        ...next,
        promptNodes: creatorPromptNodesFromCommonInput(next.promptInputSnapshot.commonInput),
      }),
    );
    const latestRun = latestVersionGenerationRun(next, options.series?.versions ?? []);
    const restoredTargets = latestVersionGenerationTargets(next, options.series?.versions ?? []);
    options.setGenerationTargets((current) =>
      restoredTargets.length
        ? restoredTargets
        : current.length
          ? current
          : initialGenerationTargets({
              creationDraft: null,
              imageGenerationRoutes: options.data.imageGenerationRoutes,
            }),
    );
    const preset = latestRun
      ? (options.data.canvasPresets.find((item) => item.stableKey === latestRun.canvasPresetKey) ??
        options.data.canvasPresets.find((item) => item.width === latestRun.width && item.height === latestRun.height))
      : null;
    options.setCanvasPresetKey(preset?.stableKey ?? '');
  });

  const chooseVersion = useStableCallback((id: string) => {
    const next = options.series?.versions.find((item) => item.id === id);
    if (!next) return;
    setVersionId(next.id);
    restoreVersion(next);
  });

  const restoreDraft = useStableCallback((draft: CreationDraftDto | null) => {
    restoredVersionIdRef.current = null;
    setHydratedVersionId(null);
    options.replaceDraftSession(draft);
    options.setTargetAlbumId(draft?.targetAlbumId ?? null);
    options.setNewTitle(draft?.title ?? '');
    const termPromptLocale = draft?.termPromptLocale ?? options.defaultPromptLocale ?? options.locale;
    options.replacePromptDocument(
      promptDocument(options.data, {
        manualPrompt: draft?.text ?? '',
        promptNodes: draft?.promptNodes ?? [],
        referenceAssets: draft?.referenceAssets ?? [],
        termIds: draft?.termIds ?? [],
        wordPaletteReferences: draft?.wordPaletteReferences ?? [],
        termPromptLocale,
      }),
    );
    options.setDictionaryScope(draft?.dictionaryScope ?? emptyCreationDictionaryScope());
    options.setCanvasPresetKey(draft?.canvasPresetKey ?? '');
    const restoredTargets = draft
      ? draft.modelTargets.length
        ? draft.modelTargets
        : draft.selectedModelKeys.map((modelKey) => ({
            modelKey,
            count: draft.repeatCount,
            quality: draft.quality,
          }))
      : [];
    options.setGenerationTargets(
      restoredTargets.length
        ? restoredTargets
        : initialGenerationTargets({
            creationDraft: draft,
            imageGenerationRoutes: options.data.imageGenerationRoutes,
          }),
    );
  });

  const startNewSession = useStableCallback((albumId: string | null) => {
    const defaults =
      options.data.albums.find((album) => album.id === albumId)?.creationDefaults ?? emptyAlbumCreationDefaults();
    const termPromptLocale = options.defaultPromptLocale ?? options.locale;
    restoredVersionIdRef.current = null;
    setHydratedVersionId(null);
    options.replaceDraftSession(null);
    options.setTargetAlbumId(albumId);
    options.setNewTitle('');
    options.replacePromptDocument(
      promptDocument(options.data, {
        manualPrompt: '',
        promptNodes: [],
        referenceAssets: [],
        termIds: [],
        wordPaletteReferences: defaults.recipes,
        termPromptLocale,
      }),
    );
    options.setDictionaryScope({
      ...defaults.dictionaryScope,
      sources: defaults.dictionaryScope.sources.map((source) => ({ ...source })),
    });
    options.setCanvasPresetKey('');
    options.setGenerationTargets(
      initialGenerationTargets({
        creationDraft: null,
        imageGenerationRoutes: options.data.imageGenerationRoutes,
      }),
    );
  });

  const applyInputStash = useStableCallback((stash: CreationInputStashDto) => {
    options.replacePromptDocument(promptDocument(options.data, stash.snapshot));
    options.setDictionaryScope(stash.snapshot.dictionaryScope);
    options.setCanvasPresetKey(stash.snapshot.canvasPresetKey ?? '');
    options.setGenerationTargets(stash.snapshot.generationTargets);
    if (options.creationMode === 'new') {
      options.setNewTitle(stash.snapshot.title);
      options.patchSavedDraftTitle(stash.snapshot.title);
    }
  });

  const resetHydration = useStableCallback(() => {
    restoredVersionIdRef.current = null;
    setHydratedVersionId(null);
  });

  useEffect(() => {
    if (options.creationMode !== 'existing' || !options.series) return;
    const next =
      options.series.versions.find((item) => item.id === options.locationVersionId) ??
      options.series.versions.find((item) => item.id === options.series?.currentVersionId) ??
      options.series.versions[0];
    setVersionId(next?.id ?? '');
    if (restoredVersionIdRef.current !== (next?.id ?? null)) restoreVersion(next);
  }, [options.creationMode, options.locationVersionId, options.series, restoreVersion]);

  useEffect(() => {
    if (options.creationMode !== 'existing' || !version || restoredVersionIdRef.current === version.id) return;
    restoreVersion(version);
  }, [options.creationMode, restoreVersion, version]);

  return {
    applyInputStash,
    chooseVersion,
    hydratedVersionId,
    resetHydration,
    restoreDraft,
    restoreVersion,
    setVersionId,
    startNewSession,
    version,
    versionId,
  };
}

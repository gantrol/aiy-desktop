import type {
  AssetDto,
  CreationDictionaryScopeDto,
  CreationInputSnapshotDto,
  CreatorAgentScope,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
} from '@/shared/contracts';
import {
  creationDraftCommitIdentity,
  creationDraftSaveSnapshot,
  type CreationDraftPromptSnapshot,
  type CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  appliedPalettes: CreationDraftPromptSnapshot['appliedPalettes'];
  canvasPresetKey: string | null;
  capturePrompt(): CreationDraftPromptSnapshot;
  creationMode: 'existing' | 'new';
  dictionaryScope: CreationDictionaryScopeDto;
  generationTargets: readonly GenerationTargetInput[];
  getDraftId(): string | null;
  manualPrompt: string;
  promptNodes: CreationDraftPromptSnapshot['nodes'];
  quality: GenerationTargetInput['quality'];
  referenceAssets: readonly AssetDto[];
  repeatCount: number;
  resolvedPrompt: string;
  saveDraft(albumId?: string | null): Promise<{ id: string }>;
  selectedModelKeys: readonly string[];
  selectedTerms: CreationDraftPromptSnapshot['selectedTerms'];
  sessionHostSeries: PromptSeriesDto | null;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
  title: string;
}

export function useCreatorDraftProjection(options: Options) {
  const snapshotForPrompt = (
    prompt: CreationDraftPromptSnapshot,
    targetAlbumOverride: string | null | undefined = undefined,
  ) =>
    creationDraftSaveSnapshot({
      targetAlbumId: targetAlbumOverride === undefined ? options.targetAlbumId : targetAlbumOverride,
      title: options.title,
      prompt,
      referenceAssetIds: options.referenceAssets.map((asset) => asset.id),
      termPromptLocale: options.termPromptLocale,
      dictionaryScope: options.dictionaryScope,
      canvasPresetKey: options.canvasPresetKey,
      quality: options.quality,
      selectedModelKeys: [...options.selectedModelKeys],
      repeatCount: options.repeatCount,
      generationTargets: options.generationTargets.map((target) => ({ ...target })),
    });
  const captureDraft = useStableCallback(
    (
      targetAlbumOverride: string | null | undefined = undefined,
      prompt: CreationDraftPromptSnapshot = options.capturePrompt(),
    ): CreationDraftSaveSnapshot => snapshotForPrompt(prompt, targetAlbumOverride),
  );
  const captureCommitIdentity = useStableCallback(() => {
    const draftId = options.getDraftId();
    if (!draftId) return null;
    try {
      return creationDraftCommitIdentity(draftId, captureDraft());
    } catch {
      return null;
    }
  });
  const ensureScope = useStableCallback(async (): Promise<CreatorAgentScope> => {
    if (options.creationMode === 'existing' && options.sessionHostSeries) {
      return { kind: 'SERIES', id: options.sessionHostSeries.id };
    }
    const draft = await options.saveDraft();
    return { kind: 'DRAFT', id: draft.id };
  });
  const isScopeCurrent = useStableCallback((scope: CreatorAgentScope) =>
    scope.kind === 'SERIES'
      ? options.creationMode === 'existing' && options.sessionHostSeries?.id === scope.id
      : options.creationMode === 'new' && options.getDraftId() === scope.id,
  );
  const currentInput: CreationInputSnapshotDto = {
    schemaVersion: 1,
    title: options.creationMode === 'new' ? options.title : (options.sessionHostSeries?.title ?? ''),
    manualPrompt: options.manualPrompt,
    promptNodes: options.promptNodes,
    resolvedPrompt: options.resolvedPrompt,
    referenceAssetIds: options.referenceAssets.map((asset) => asset.id),
    referenceAssets: [...options.referenceAssets],
    termPromptLocale: options.termPromptLocale,
    termIds: options.selectedTerms.map((term) => term.id),
    wordPaletteReferences: options.appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
    dictionaryScope: options.dictionaryScope,
    canvasPresetKey: options.canvasPresetKey,
    generationTargets: options.generationTargets.map((target) => ({ ...target })),
  };

  return { captureCommitIdentity, captureDraft, currentInput, ensureScope, isScopeCurrent, snapshotForPrompt };
}

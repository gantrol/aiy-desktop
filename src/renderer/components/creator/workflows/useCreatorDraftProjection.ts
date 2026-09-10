import {
  creationDraftCommitIdentity,
  creationDraftSaveSnapshot,
  type CreationDraftPromptSnapshot,
  type CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';
import type {
  AssetDto,
  CreationDictionaryScopeDto,
  CreationInputSnapshotDto,
  CreationVideoAttachmentDto,
  CreatorAgentScope,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
} from '@/shared/contracts';

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
  document?: CreationDraftPromptSnapshot['document'];
  quality: GenerationTargetInput['quality'];
  referenceAssets: readonly AssetDto[];
  videoAttachments?: readonly CreationVideoAttachmentDto[];
  repeatCount: number;
  resolvedPrompt: string;
  resolvePrompt(prompt: CreationDraftPromptSnapshot): string;
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
      videoMaterialIds: (options.videoAttachments ?? []).map((video) => video.materialId),
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
    document: options.document,
    resolvedPrompt: options.resolvedPrompt,
    referenceAssetIds: [
      ...new Set([
        ...options.referenceAssets.map((asset) => asset.id),
        ...(options.document ? blockDocumentAssetIds(options.document) : []),
      ]),
    ],
    referenceAssets: [...options.referenceAssets],
    videoMaterialIds: (options.videoAttachments ?? []).map((video) => video.materialId),
    videoAttachments: [...(options.videoAttachments ?? [])],
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

  const captureInput = useStableCallback((): CreationInputSnapshotDto => {
    const prompt = options.capturePrompt();
    const snapshot = snapshotForPrompt(prompt);
    return {
      ...currentInput,
      manualPrompt: prompt.manualPrompt,
      resolvedPrompt: options.resolvePrompt(prompt),
      promptNodes: prompt.nodes,
      document: prompt.document,
      referenceAssetIds: snapshot.referenceAssetIds,
      termIds: snapshot.termIds,
      wordPaletteReferences: snapshot.wordPaletteReferences,
    };
  });

  return {
    captureCommitIdentity,
    captureDraft,
    captureInput,
    currentInput,
    ensureScope,
    isScopeCurrent,
    snapshotForPrompt,
  };
}

import type {
  AlbumCreationDefaultsDto,
  CreationDictionaryScopeDto,
  CreationDraftSaveInput,
  CreatorPromptNodeInput,
  GenerationQuality,
  GenerationTargetInput,
  Locale,
  TermListItem,
} from '@/shared/contracts';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';

export interface CreationDraftPromptSnapshot {
  nodes: CreatorPromptNodeInput[];
  manualPrompt: string;
  selectedTerms: TermListItem[];
  appliedPalettes: AppliedWordPalette[];
}

export interface CreationDraftSnapshotSource {
  targetAlbumId: string | null;
  title: string;
  prompt: CreationDraftPromptSnapshot;
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  dictionaryScope: CreationDictionaryScopeDto;
  canvasPresetKey: string | null;
  quality: GenerationQuality;
  selectedModelKeys: string[];
  repeatCount: number;
  generationTargets: GenerationTargetInput[];
}

export type CreationDraftSaveSnapshot = Omit<CreationDraftSaveInput, 'id' | 'expectedUpdatedAt'>;

export function creationDraftSaveSnapshot(source: CreationDraftSnapshotSource): CreationDraftSaveSnapshot {
  return {
    targetAlbumId: source.targetAlbumId,
    title: source.title,
    text: source.prompt.manualPrompt,
    promptNodes: source.prompt.nodes,
    referenceAssetIds: source.referenceAssetIds,
    termPromptLocale: source.termPromptLocale,
    termIds: source.prompt.selectedTerms.map((term) => term.id),
    wordPaletteReferences: source.prompt.appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
    dictionaryScope: source.dictionaryScope,
    canvasPresetKey: source.canvasPresetKey,
    quality: source.quality,
    selectedModelKeys: source.selectedModelKeys,
    repeatCount: source.repeatCount,
    modelTargets: source.generationTargets,
  };
}

function paletteReferenceKey(reference: CreationDraftSaveSnapshot['wordPaletteReferences'][number]) {
  return JSON.stringify([
    reference.paletteId,
    reference.paletteRevisionId,
    reference.promptLocale,
    Object.entries(reference.parameterValues).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

function dictionaryScopeKey(scope: CreationDictionaryScopeDto) {
  return JSON.stringify([
    scope.mode,
    scope.includeLocalTerms,
    scope.sources.map((source) => `${source.packId}:${source.packReleaseId}`).sort(),
  ]);
}

function generationTargetsKey(targets: readonly GenerationTargetInput[]) {
  return JSON.stringify(targets.map((target) => [target.modelKey, target.count, target.quality]));
}

export function creationDraftSnapshotHasMeaningfulInput(
  snapshot: CreationDraftSaveSnapshot,
  defaults: AlbumCreationDefaultsDto | null,
  defaultGenerationTargets: readonly GenerationTargetInput[] = [],
) {
  const resolvedDefaults = defaults ?? emptyAlbumCreationDefaults();
  if (
    snapshot.title.trim() ||
    snapshot.text.trim() ||
    snapshot.referenceAssetIds.length ||
    snapshot.termIds.length ||
    (snapshot.promptNodes ?? []).some(
      (node) => node.kind === 'TERM' || (node.kind === 'TEXT' && Boolean(node.text.trim())),
    )
  ) {
    return true;
  }
  const defaultPaletteKeys = resolvedDefaults.recipes.map(paletteReferenceKey).sort();
  const currentPaletteKeys = snapshot.wordPaletteReferences.map(paletteReferenceKey).sort();
  if (JSON.stringify(currentPaletteKeys) !== JSON.stringify(defaultPaletteKeys)) return true;
  if (
    snapshot.dictionaryScope &&
    dictionaryScopeKey(snapshot.dictionaryScope) !== dictionaryScopeKey(resolvedDefaults.dictionaryScope)
  ) {
    return true;
  }
  return Boolean(
    snapshot.canvasPresetKey ||
    generationTargetsKey(snapshot.modelTargets ?? []) !== generationTargetsKey(defaultGenerationTargets),
  );
}

export function creationDraftCommitIdentity(draftId: string, snapshot: CreationDraftSaveSnapshot): string {
  return JSON.stringify({ draftId, snapshot });
}

import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
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
import { blockDocumentAssetIds, blockDocumentImportIds, type BlockDocument } from '@/shared/contracts/block-document';

export interface CreationDraftPromptSnapshot {
  document?: BlockDocument;
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
  videoMaterialIds?: string[];
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
    ...(source.prompt.document ? { document: source.prompt.document } : {}),
    referenceAssetIds: [
      ...new Set([
        ...source.referenceAssetIds,
        ...(source.prompt.document ? blockDocumentAssetIds(source.prompt.document) : []),
      ]),
    ],
    ...(source.videoMaterialIds ? { videoMaterialIds: [...source.videoMaterialIds] } : {}),
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

// Canonical keys need code-unit ordering, including strings that a locale collates equally.
function compareSnapshotKeys(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function dictionaryScopeKey(scope: CreationDictionaryScopeDto) {
  return JSON.stringify([
    scope.mode,
    scope.includeLocalTerms,
    scope.sources.map((source) => `${source.packId}:${source.packReleaseId}`).sort(compareSnapshotKeys),
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
    (snapshot.document && blockDocumentImportIds(snapshot.document).length > 0) ||
    snapshot.videoMaterialIds?.length ||
    snapshot.termIds.length ||
    (snapshot.promptNodes ?? []).some(
      (node) => node.kind === 'TERM' || (node.kind === 'TEXT' && Boolean(node.text.trim())),
    )
  ) {
    return true;
  }
  const defaultPaletteKeys = resolvedDefaults.recipes.map(paletteReferenceKey).sort(compareSnapshotKeys);
  const currentPaletteKeys = snapshot.wordPaletteReferences.map(paletteReferenceKey).sort(compareSnapshotKeys);
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

import type { CreationDictionaryScopeDto, CreationDraftSaveInput, GenerationTargetInput } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';

export function creationDraftReferenceAssetIds(db: LibraryStorage['db'], draftId: string) {
  return (
    db
      .prepare(
        `SELECT asset.id FROM creation_draft_materials link
        JOIN materials material ON material.id = link.material_id
        JOIN image_assets asset ON asset.id = material.image_asset_id
        WHERE link.creation_draft_id = ? AND material.kind = 'IMAGE'
          AND material.deleted_at IS NULL AND asset.deleted_at IS NULL
        ORDER BY link.sort_order`,
      )
      .all(draftId) as JsonMap[]
  ).map((row) => text(row.id));
}

export function normalizeCreationDraftSave(
  input: CreationDraftSaveInput,
  targetAlbumId: string | null,
  dictionaryScope: CreationDictionaryScopeDto,
  modelTargets: readonly GenerationTargetInput[],
) {
  return {
    targetAlbumId,
    text: input.text.trim(),
    title: input.title.trim(),
    termPromptLocale: input.termPromptLocale,
    termIdsJson: JSON.stringify([...new Set(input.termIds)]),
    paletteReferencesJson: JSON.stringify(input.wordPaletteReferences),
    promptNodesJson: JSON.stringify(input.promptNodes ?? []),
    dictionaryScopeMode: dictionaryScope.mode,
    dictionarySourcesJson: JSON.stringify(dictionaryScope.sources),
    dictionaryIncludesLocalTerms: dictionaryScope.includeLocalTerms,
    canvasPresetKey: input.canvasPresetKey ?? '',
    quality: input.quality,
    selectedModelKeysJson: JSON.stringify([...new Set(input.selectedModelKeys)]),
    repeatCount: Math.max(1, input.repeatCount),
    modelTargetsJson: JSON.stringify(modelTargets),
    referenceAssetIds: [...new Set(input.referenceAssetIds)],
  };
}

export function storedCreationDraftMatches(
  row: JsonMap,
  normalized: ReturnType<typeof normalizeCreationDraftSave>,
  storedReferenceAssetIds: readonly string[],
) {
  return (
    (row.target_album_id ? text(row.target_album_id) : null) === normalized.targetAlbumId &&
    text(row.text_content) === normalized.text &&
    text(row.title) === normalized.title &&
    text(row.term_prompt_locale) === normalized.termPromptLocale &&
    text(row.term_ids_json) === normalized.termIdsJson &&
    text(row.palette_references_json) === normalized.paletteReferencesJson &&
    text(row.prompt_nodes_json) === normalized.promptNodesJson &&
    text(row.dictionary_scope_mode) === normalized.dictionaryScopeMode &&
    text(row.dictionary_pack_sources_json) === normalized.dictionarySourcesJson &&
    Boolean(row.dictionary_include_local_terms) === normalized.dictionaryIncludesLocalTerms &&
    text(row.canvas_preset_key) === normalized.canvasPresetKey &&
    text(row.quality) === normalized.quality &&
    text(row.selected_model_keys_json) === normalized.selectedModelKeysJson &&
    Number(row.repeat_count) === normalized.repeatCount &&
    text(row.model_targets_json) === normalized.modelTargetsJson &&
    JSON.stringify(storedReferenceAssetIds) === JSON.stringify(normalized.referenceAssetIds)
  );
}

export function nextCreationDraftUpdatedAt(previous: string | null) {
  const current = new Date().toISOString();
  if (!previous || current > previous) return current;
  const previousMilliseconds = Date.parse(previous);
  return Number.isFinite(previousMilliseconds) ? new Date(previousMilliseconds + 1).toISOString() : current;
}

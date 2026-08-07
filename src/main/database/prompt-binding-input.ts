import type Database from 'better-sqlite3';
import type {
  PromptCommonAssetReferenceDto,
  PromptCommonInputDto,
  PromptCommonParameterReferenceDto,
  PromptCommonRecipeReferenceDto,
  PromptCommonTermReferenceDto,
} from '@/shared/contracts';
import { type JsonMap, text } from '@/main/database/values';
import { readRecipeContentSnapshot, recipeContentTerms } from '@/main/database/word-palette-content';

function tableExists(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseObject(value: unknown): JsonMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonMap;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function parseMaps(value: unknown) {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function parameterValues(value: unknown) {
  return Object.fromEntries(
    Object.entries(parseObject(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function promptDirectTermsFromBindings(
  db: Database.Database,
  promptVersionId: string,
): PromptCommonTermReferenceDto[] {
  if (!tableExists(db, 'prompt_term_bindings') || !tableExists(db, 'terms')) return [];
  return (
    db
      .prepare(
        `SELECT binding.term_id, term.current_revision_id
    FROM prompt_term_bindings binding
    JOIN terms term ON term.id = binding.term_id
    WHERE binding.prompt_version_id = ? AND term.current_revision_id IS NOT NULL
    ORDER BY binding.sort_order, binding.rowid`,
      )
      .all(promptVersionId) as JsonMap[]
  ).map((row) => ({
    termId: text(row.term_id),
    termRevisionId: text(row.current_revision_id),
  }));
}

function recipeTerms(db: Database.Database, revisionId: string): PromptCommonTermReferenceDto[] {
  if (!tableExists(db, 'word_palette_revision_terms')) return [];
  return (
    db
      .prepare(
        `SELECT item.term_id, term.current_revision_id
    FROM word_palette_revision_terms item
    JOIN terms term ON term.id = item.term_id
    WHERE item.palette_revision_id = ? AND term.current_revision_id IS NOT NULL
    ORDER BY item.sort_order, item.rowid`,
      )
      .all(revisionId) as JsonMap[]
  ).map((row) => ({
    termId: text(row.term_id),
    termRevisionId: text(row.current_revision_id),
  }));
}

function recipeParameters(
  db: Database.Database,
  revisionId: string,
  values: Record<string, string>,
): PromptCommonParameterReferenceDto[] {
  if (
    !tableExists(db, 'word_palette_revision_parameters') ||
    !tableExists(db, 'word_palette_revision_parameter_options')
  )
    return [];
  return (
    db
      .prepare(
        `SELECT parameter.id AS parameter_revision_id,
      parameter.stable_key, option.id AS option_id, option.value_key
    FROM word_palette_revision_parameters parameter
    JOIN word_palette_revision_parameter_options option
      ON option.parameter_revision_id = parameter.id
    WHERE parameter.palette_revision_id = ?
    ORDER BY parameter.sort_order, parameter.rowid, option.sort_order, option.rowid`,
      )
      .all(revisionId) as JsonMap[]
  )
    .filter((row) => values[text(row.stable_key)] === text(row.value_key))
    .map((row) => ({
      parameterRevisionId: text(row.parameter_revision_id),
      stableKey: text(row.stable_key),
      optionId: text(row.option_id),
      valueKey: text(row.value_key),
    }));
}

function recipeReferences(db: Database.Database, revisionId: string): PromptCommonAssetReferenceDto[] {
  if (!tableExists(db, 'word_palette_revision_media') || !tableExists(db, 'image_assets')) return [];
  return (
    db
      .prepare(
        `SELECT asset.id, asset.object_hash
    FROM word_palette_revision_media media
    JOIN image_assets asset ON asset.id = media.image_asset_id
    WHERE media.palette_revision_id = ? AND asset.deleted_at IS NULL
    ORDER BY media.sort_order, media.rowid`,
      )
      .all(revisionId) as JsonMap[]
  ).map((row) => ({
    assetId: text(row.id),
    contentHash: text(row.object_hash),
    role: 'RECIPE_REFERENCE',
  }));
}

export function promptRecipesFromBindings(
  db: Database.Database,
  promptVersionId: string,
): PromptCommonInputDto['recipes'] {
  if (!tableExists(db, 'prompt_palette_bindings') || !tableExists(db, 'word_palette_revisions')) return [];
  return (
    db
      .prepare(
        `SELECT binding.palette_id, binding.palette_revision_id,
      binding.parameter_values_json, binding.prompt_locale,
      revision.name, revision.name_locale,
      COALESCE((
        SELECT json_group_array(json_object('locale', localization.locale, 'name', localization.name))
        FROM (
          SELECT locale, name FROM word_palette_revision_localizations
          WHERE palette_revision_id = revision.id ORDER BY locale
        ) localization
      ), '[]') AS localizations_json
    FROM prompt_palette_bindings binding
    JOIN word_palette_revisions revision
      ON revision.id = binding.palette_revision_id AND revision.palette_id = binding.palette_id
    WHERE binding.prompt_version_id = ?
    ORDER BY binding.sort_order, binding.rowid`,
      )
      .all(promptVersionId) as JsonMap[]
  ).map((row): PromptCommonRecipeReferenceDto => {
    const paletteId = text(row.palette_id);
    const paletteRevisionId = text(row.palette_revision_id);
    const values = parameterValues(row.parameter_values_json);
    const contentNodes = readRecipeContentSnapshot(db, paletteRevisionId, values);
    const terms = [...recipeTerms(db, paletteRevisionId), ...recipeContentTerms(contentNodes)].filter(
      (term, index, all) => all.findIndex((item) => item.termId === term.termId) === index,
    );
    return {
      useId: `${paletteId}:${paletteRevisionId}`,
      paletteId,
      paletteRevisionId,
      name: text(row.name) || paletteId,
      nameLocale: text(row.name_locale),
      localizations: parseMaps(row.localizations_json).map((localization) => ({
        locale: text(localization.locale),
        name: text(localization.name),
      })),
      promptLocale: row.prompt_locale === 'zh' ? 'zh' : 'en',
      parameterValues: values,
      terms,
      parameters: recipeParameters(db, paletteRevisionId, values),
      contentNodes,
      references: recipeReferences(db, paletteRevisionId),
    };
  });
}

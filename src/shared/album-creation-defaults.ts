import type {
  AlbumCreationDefaultsDto,
  AlbumDictionarySourceDto,
  CreationDictionaryScopeDto,
  Locale,
  WordPaletteReferenceInput,
} from '@/shared/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const emptyCreationDictionaryScope = (): CreationDictionaryScopeDto => ({
  mode: 'ALL',
  sources: [],
  includeLocalTerms: true,
});

export const emptyAlbumCreationDefaults = (): AlbumCreationDefaultsDto => ({
  schemaVersion: 1,
  recipes: [],
  dictionaryScope: emptyCreationDictionaryScope(),
});

function locale(value: unknown): Locale {
  return value === 'zh' ? 'zh' : 'en';
}

function recipe(value: unknown): WordPaletteReferenceInput | null {
  if (!isRecord(value) || typeof value.paletteId !== 'string' || typeof value.paletteRevisionId !== 'string') {
    return null;
  }
  const parameterValues = isRecord(value.parameterValues)
    ? Object.fromEntries(
        Object.entries(value.parameterValues).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  return {
    paletteId: value.paletteId,
    paletteRevisionId: value.paletteRevisionId,
    parameterValues,
    promptLocale: locale(value.promptLocale),
  };
}

function dictionarySource(value: unknown): AlbumDictionarySourceDto | null {
  if (!isRecord(value) || typeof value.packId !== 'string' || typeof value.packReleaseId !== 'string') return null;
  return { packId: value.packId, packReleaseId: value.packReleaseId };
}

export function normalizeAlbumCreationDefaults(value: unknown): AlbumCreationDefaultsDto {
  if (!isRecord(value)) return emptyAlbumCreationDefaults();
  const recipes = Array.isArray(value.recipes)
    ? value.recipes
        .flatMap((item) => recipe(item) ?? [])
        .filter(
          (item, index, items) => items.findIndex((candidate) => candidate.paletteId === item.paletteId) === index,
        )
    : [];
  const rawScope = isRecord(value.dictionaryScope) ? value.dictionaryScope : {};
  const sources = Array.isArray(rawScope.sources)
    ? rawScope.sources
        .flatMap((item) => dictionarySource(item) ?? [])
        .filter((item, index, items) => items.findIndex((candidate) => candidate.packId === item.packId) === index)
    : [];
  return {
    schemaVersion: 1,
    recipes,
    dictionaryScope: {
      mode: rawScope.mode === 'SELECTED' ? 'SELECTED' : 'ALL',
      sources,
      includeLocalTerms: rawScope.includeLocalTerms !== false,
    },
  };
}

export function parseAlbumCreationDefaults(value: string): AlbumCreationDefaultsDto {
  try {
    return normalizeAlbumCreationDefaults(JSON.parse(value));
  } catch {
    return emptyAlbumCreationDefaults();
  }
}

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDictionaryImports } from '@/main/dictionary/dictionary-import';
import { readV03FixtureDocument } from '@/main/database/packs/fixture-contract';
import type { FixturePackProfile } from '@/main/database/packs/fixture-pack-profile';
import type { JsonMap } from '@/main/database/core/values';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const maps = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object') : [];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as JsonMap)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

export function fixtureContentHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function catalogSuffix(stableKey: string) {
  return trimSurroundingCharacters(stableKey.toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');
}

function importedTerm(row: JsonMap): JsonMap | null {
  const stableKey = text(row.stableKey);
  if (!stableKey) return null;
  const suffix = catalogSuffix(stableKey);
  return {
    id: `term_catalog_${suffix}`,
    revisionId: `tr_catalog_${suffix}_01`,
    revisionNo: 1,
    stableKey,
    editorialState: 'DRAFT',
    title: text(row.title),
    titleLocale: text(row.titleLocale),
    definition: text(row.definition),
    aliases: strings(row.aliases),
    localizations: maps(row.localizations),
    classificationKeys: strings(row.classificationKeys),
    primaryDirectoryClassificationKey: text(row.primaryDirectoryClassificationKey),
    expressions: maps(row.expressions),
  };
}

export function fixtureTermSemanticValue(term: JsonMap) {
  return {
    stableKey: text(term.stableKey),
    title: text(term.title).trim(),
    titleLocale: text(term.titleLocale).trim(),
    definition: text(term.definition).trim(),
    aliases: strings(term.aliases)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    localizations: maps(term.localizations)
      .map((item) => ({
        locale: text(item.locale).trim(),
        title: text(item.title).trim(),
        definition: text(item.definition).trim(),
        aliases: strings(item.aliases)
          .map((value) => value.trim())
          .filter(Boolean)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      }))
      .sort((left, right) => left.locale.localeCompare(right.locale)),
    classificationKeys: strings(term.classificationKeys),
    primaryDirectoryClassificationKey: text(term.primaryDirectoryClassificationKey),
    expressions: maps(term.expressions)
      .map((item) => ({
        contextKey: text(item.contextKey).trim(),
        modelKey: text(item.modelKey).trim(),
        locale: text(item.locale).trim(),
        positive: text(item.positive).trim(),
        negative: text(item.negative).trim(),
      }))
      .sort((left, right) =>
        `${left.contextKey}:${left.modelKey}:${left.locale}`.localeCompare(
          `${right.contextKey}:${right.modelKey}:${right.locale}`,
        ),
      ),
  };
}

export function fixtureTermSourceHash(term: JsonMap) {
  return fixtureContentHash({ contract: 'CONTENT_SOURCE_TERM_V1', term: fixtureTermSemanticValue(term) });
}

export function fixtureDerivedTermRevisionId(baseRevisionId: string, sourceHash: string) {
  return `${baseRevisionId}_fixture_${sourceHash.slice(0, 16)}`;
}

export function fixturePaletteCatalogContentHash(palette: JsonMap, termIds: ReadonlyMap<string, string>) {
  const sourceContents = (value: unknown) =>
    maps(value).map((content) => {
      if (content.kind === 'TEXT') {
        return {
          kind: 'TEXT' as const,
          promptFragment: text(content.promptFragment),
          negativeFragment: text(content.negativeFragment),
        };
      }
      const stableKey = text(content.termStableKey);
      const termId = termIds.get(stableKey);
      if (!termId) throw new Error(`Content recipe references an unknown term: ${stableKey}`);
      return { kind: 'TERM' as const, termId };
    });
  const parameters = maps(palette.parameters).map((parameter) => ({
    stableKey: text(parameter.stableKey).trim(),
    name: text(parameter.name).trim(),
    nameLocale: text(parameter.nameLocale).trim().toLocaleLowerCase(),
    localizations: maps(parameter.localizations)
      .map((localization) => ({ locale: text(localization.locale), name: text(localization.name) }))
      .sort((left, right) => left.locale.localeCompare(right.locale)),
    required: Boolean(parameter.required),
    options: maps(parameter.options).map((option) => {
      const value = text(option.value).trim();
      return {
        value,
        label: text(option.label).trim() || value,
        labelLocale: text(option.labelLocale).trim().toLocaleLowerCase(),
        localizations: maps(option.localizations)
          .map((localization) => ({ locale: text(localization.locale), label: text(localization.label) }))
          .sort((left, right) => left.locale.localeCompare(right.locale)),
        contents: sourceContents(option.contents),
      };
    }),
  }));
  const promptNodes = maps(palette.promptNodes).map((node) =>
    node.kind === 'SLOT'
      ? { kind: 'SLOT' as const, stableKey: text(node.stableKey).trim() }
      : sourceContents([node])[0],
  );
  const referencedTermIds = [
    ...promptNodes.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : [])),
    ...parameters.flatMap((parameter) =>
      parameter.options.flatMap((option) =>
        option.contents.flatMap((content) => (content.kind === 'TERM' ? [content.termId] : [])),
      ),
    ),
  ];
  const normalized = {
    name: text(palette.name).trim(),
    nameLocale: text(palette.nameLocale).trim().toLocaleLowerCase(),
    description: text(palette.description).trim(),
    localizations: maps(palette.localizations)
      .map((localization) => ({
        locale: text(localization.locale),
        name: text(localization.name),
        description: text(localization.description),
      }))
      .sort((left, right) => left.locale.localeCompare(right.locale)),
    termIds: [...new Set(referencedTermIds)],
    referenceAssetIds: [],
    parameters,
    promptNodes,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export interface FixturePackSourceTerm {
  itemKey: string;
  stableKey: string;
  localObjectId: string;
  baseLocalRevisionId: string;
  derivedLocalRevisionId: string;
  packageRevisionId: string;
  contentHash: string;
}

export interface FixturePackSourceRecipe {
  itemKey: string;
  stableKey: string;
  localObjectId: string;
  localContentHash: string;
  packageRevisionId: string;
  contentHash: string;
  source: JsonMap;
}

export interface FixturePackSupplementalItem {
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus: string;
  metadata: JsonMap;
  provenance: JsonMap;
  localObjectType: string;
  localObjectId: string;
  localRevisionId: string;
}

export interface FixturePackSource {
  profile: FixturePackProfile;
  sourceDigest: string;
  releaseId: string;
  releaseVersion: string;
  dictionaryRevision: string;
  paletteRevision: string;
  terms: FixturePackSourceTerm[];
  recipes: FixturePackSourceRecipe[];
  supplementalItems: FixturePackSupplementalItem[];
  documents: FixturePackSourceDocuments;
}

export interface FixturePackSourcePaths {
  fixturePath: string;
  dictionaryPath: string;
  palettePath?: string;
  supplementalItems?: readonly FixturePackSupplementalItem[];
  prepared?: PreparedFixturePackSourceDocuments;
}

export interface FixturePackSourceDocuments {
  fixture: JsonMap;
  dictionary: JsonMap;
  dictionaryCatalogRows: JsonMap[];
  palette: JsonMap;
}

export interface PreparedFixturePackSourceDocuments extends FixturePackSourceDocuments {
  dictionaryTermPaths: readonly string[];
}

function safeVersionPart(value: string) {
  return trimSurroundingCharacters(value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), '-') || 'unversioned';
}

export function readFixturePackSource(profile: FixturePackProfile, paths: FixturePackSourcePaths): FixturePackSource {
  const fixture = paths.prepared?.fixture ?? readV03FixtureDocument(paths.fixturePath);
  const fixtureLibrary = fixture.library && typeof fixture.library === 'object' ? (fixture.library as JsonMap) : {};
  if (text(fixtureLibrary.id) !== profile.fixtureLibraryId) {
    throw new Error(`Content package ${profile.key} does not match its declared source library`);
  }

  const dictionaryRoot = path.dirname(paths.dictionaryPath);
  const dictionary = paths.prepared?.dictionary ?? (JSON.parse(readFileSync(paths.dictionaryPath, 'utf8')) as JsonMap);
  const dictionaryRevision = text(dictionary.structureRevision);
  if (!dictionaryRevision) throw new Error('Content dictionary revision is required');
  const inlineTerms = profile.includeInlineTerms ? maps(dictionary.terms) : [];
  const termFiles = strings(dictionary.termFiles);
  const dictionaryTermPaths =
    paths.prepared?.dictionaryTermPaths ?? termFiles.map((fileName) => path.resolve(dictionaryRoot, fileName));
  if (dictionaryTermPaths.length !== termFiles.length) {
    throw new Error('Content dictionary term file snapshot does not match its index');
  }
  const dictionaryCatalogRows = paths.prepared
    ? [...paths.prepared.dictionaryCatalogRows]
    : readDictionaryImports(dictionaryTermPaths, { rootPath: dictionaryRoot });
  const catalogTerms = dictionaryCatalogRows
    .map((row) => importedTerm(row))
    .filter((term): term is JsonMap => term !== null);
  const retiredTermIds = new Set(strings(dictionary.retiredTermIds));
  const termRows = [...inlineTerms, ...catalogTerms].filter((term) => !retiredTermIds.has(text(term.id)));
  const stableKeys = new Set<string>();
  const terms = termRows.map((term): FixturePackSourceTerm => {
    const stableKey = text(term.stableKey);
    const localObjectId = text(term.id);
    const baseLocalRevisionId = text(term.revisionId);
    if (!stableKey || !localObjectId || !baseLocalRevisionId || stableKeys.has(stableKey)) {
      throw new Error(`Content package contains an invalid or duplicate term identity: ${stableKey}`);
    }
    stableKeys.add(stableKey);
    const sourceHash = fixtureTermSourceHash(term);
    return {
      itemKey: `term:${stableKey}`,
      stableKey,
      localObjectId,
      baseLocalRevisionId,
      derivedLocalRevisionId: fixtureDerivedTermRevisionId(baseLocalRevisionId, sourceHash),
      packageRevisionId: `content-term:${stableKey}:${sourceHash.slice(0, 24)}`,
      contentHash: `sha256:${sourceHash}`,
    };
  });

  const termIds = new Map(terms.map((term) => [term.stableKey, term.localObjectId]));
  const palette =
    paths.prepared?.palette ??
    (paths.palettePath ? (JSON.parse(readFileSync(paths.palettePath, 'utf8')) as JsonMap) : {});
  const paletteRevision = text(palette.revision);
  const recipeKeys = new Set<string>();
  const recipes = maps(palette.palettes).map((recipe): FixturePackSourceRecipe => {
    const stableKey = text(recipe.stableKey);
    if (!stableKey || recipeKeys.has(stableKey)) {
      throw new Error(`Content package contains an invalid or duplicate recipe identity: ${stableKey}`);
    }
    recipeKeys.add(stableKey);
    const sourceHash = fixtureContentHash({ contract: 'CONTENT_SOURCE_RECIPE_V1', recipe });
    return {
      itemKey: `recipe:${stableKey}`,
      stableKey,
      localObjectId: `palette_catalog_${catalogSuffix(stableKey)}`,
      localContentHash: fixturePaletteCatalogContentHash(recipe, termIds),
      packageRevisionId: `content-recipe:${stableKey}:${sourceHash.slice(0, 24)}`,
      contentHash: `sha256:${sourceHash}`,
      source: recipe,
    };
  });
  const supplementalItems = [...(paths.supplementalItems ?? [])].sort((left, right) =>
    left.itemKey.localeCompare(right.itemKey),
  );
  for (const item of supplementalItems) {
    if (item.objectType !== 'TERM_EXAMPLE') continue;
    const termStableKey = text(item.metadata.termStableKey);
    if (!stableKeys.has(termStableKey)) {
      throw new Error(`Content package example references a term outside the release: ${termStableKey}`);
    }
  }
  const itemKeys = [...terms, ...recipes, ...supplementalItems].map((item) => item.itemKey);
  if (new Set(itemKeys).size !== itemKeys.length) {
    throw new Error('Content package release item identities must be unique');
  }

  const sourceDigest = fixtureContentHash({
    contract: 'CONTENT_PACKAGE_V1',
    profileKey: profile.key,
    fixtureLibraryId: profile.fixtureLibraryId,
    dictionary: {
      schemaVersion: dictionary.schemaVersion,
      structureRevision: dictionaryRevision,
      includeInlineTerms: profile.includeInlineTerms,
      facetDefinitions: dictionary.facetDefinitions,
      retiredTermIds: dictionary.retiredTermIds,
    },
    palette: { schemaVersion: palette.schemaVersion, revision: paletteRevision },
    ...(profile.releaseVersion ? { declaredVersion: profile.releaseVersion } : {}),
    items: [...terms, ...recipes, ...supplementalItems].map((item) => ({
      itemKey: item.itemKey,
      objectRevisionId: 'packageRevisionId' in item ? item.packageRevisionId : item.objectRevisionId,
      contentHash: item.contentHash,
    })),
  });
  const releaseVersion =
    profile.releaseVersion ??
    `0.0.0-fixture.${safeVersionPart(dictionaryRevision)}${
      paletteRevision ? `.${safeVersionPart(paletteRevision)}` : ''
    }.${sourceDigest.slice(0, 12)}`;
  return {
    profile,
    sourceDigest,
    releaseId: `release_${profile.key.replace(/[^a-z0-9]+/g, '_')}_${sourceDigest.slice(0, 32)}`,
    releaseVersion,
    dictionaryRevision,
    paletteRevision,
    terms,
    recipes,
    supplementalItems,
    documents: { fixture, dictionary, dictionaryCatalogRows, palette },
  };
}

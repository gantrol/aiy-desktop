import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readDictionaryImportsAsync } from '@/main/dictionary/dictionary-import';
import { parseV03FixtureDocument } from '@/main/database/packs/fixture-contract';
import type { FixturePackProfile } from '@/main/database/packs/fixture-pack-profile';
import { fixtureContentHash, type FixturePackSourcePaths } from '@/main/database/packs/fixture-pack-source';
import type { FacetSystemRoleAssignments } from '@/main/database/dictionary/facet-system-roles';
import {
  contentPackExamplesDocumentSchema,
  type ContentPackExamplesDocument,
} from '@/main/content-packs/example-manifest';
import { prepareContentPackExamples, type PreparedContentPackExample } from '@/main/content-packs/example-importer';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_FIXTURE_BYTES = 64 * 1024 * 1024;
const MAX_DICTIONARY_BYTES = 16 * 1024 * 1024;
const MAX_PALETTE_BYTES = 16 * 1024 * 1024;
const MAX_EXAMPLES_BYTES = 32 * 1024 * 1024;
const packageId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/);
const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const token = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/);
const releaseVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

const contentPackManifestSchema = z
  .object({
    // Contract version for parsing the manifest. Package content updates bump
    // `version` instead of inventing another schema revision.
    schemaVersion: z.literal(1),
    kind: z.literal('CONTENT'),
    key: stableKey,
    id: packageId,
    version: releaseVersion,
    displayName: z.string().trim().min(1).max(160),
    description: z.string().max(2_000),
    contentKinds: z.array(token).min(1),
    defaultRoles: z.array(token),
    includeInlineTerms: z.boolean().optional().default(true),
    fixtureLibraryId: stableKey,
    seedLibrary: z.boolean().optional().default(false),
    facetRoles: z
      .object({
        primaryClassification: stableKey.optional(),
        secondaryClassification: stableKey.optional(),
      })
      .strict()
      .optional(),
    source: z
      .object({
        fixture: z.string().trim().min(1).max(240),
        dictionary: z.string().trim().min(1).max(240),
        palettes: z.string().trim().min(1).max(240).optional(),
        assets: z.string().trim().min(1).max(240).optional(),
        examples: z.string().trim().min(1).max(240).optional(),
        exampleAssets: z.string().trim().min(1).max(240).optional(),
      })
      .strict(),
  })
  .strict();

export type ContentPackManifest = z.infer<typeof contentPackManifestSchema>;

export interface LoadedContentPackPackage {
  manifest: ContentPackManifest;
  packagePath: string;
  fixturePath: string;
  dictionaryPath: string;
  palettePath?: string;
  assetsRoot?: string;
  examplesPath?: string;
  exampleAssetsRoot?: string;
  examplesDocument?: ContentPackExamplesDocument;
  preparedExamples: PreparedContentPackExample[];
  packageFingerprint: string;
  sourcePaths: FixturePackSourcePaths;
  facetRoles: FacetSystemRoleAssignments;
  profile: FixturePackProfile;
}

interface ValidatedPackageFile {
  path: string;
  size: number;
}

const contentPackDictionaryIndexSchema = z
  .object({
    schemaVersion: z.enum(['0.3.0', '0.4.0']),
    structureRevision: z.string().trim().min(1).max(200),
    termFiles: z
      .array(z.string().trim().min(1).max(240))
      .max(10_000)
      .refine((files) => new Set(files).size === files.length, 'Content pack term files must be unique')
      .optional(),
  })
  .passthrough();

const contentLocale = z.string().trim().min(1).max(64);
const paletteText = z.string().max(30_000);
const paletteLocalizationSchema = z
  .object({
    locale: contentLocale,
    name: z.string().max(500),
    description: z.string().max(4_000),
  })
  .passthrough();
const paletteParameterLocalizationSchema = z.object({ locale: contentLocale, name: z.string().max(500) }).passthrough();
const paletteOptionLocalizationSchema = z.object({ locale: contentLocale, label: z.string().max(500) }).passthrough();
const paletteContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TERM'), termStableKey: stableKey }).passthrough(),
  z
    .object({
      kind: z.literal('TEXT'),
      promptFragment: paletteText,
      negativeFragment: paletteText,
    })
    .passthrough(),
]);
const palettePromptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TERM'), termStableKey: stableKey }).passthrough(),
  z
    .object({
      kind: z.literal('TEXT'),
      promptFragment: paletteText,
      negativeFragment: paletteText,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal('SLOT'),
      stableKey: z
        .string()
        .trim()
        .min(2)
        .max(64)
        .regex(/^[a-z][a-z0-9_]+$/),
    })
    .passthrough(),
]);
const paletteParameterSchema = z
  .object({
    stableKey: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z][a-z0-9_]+$/),
    name: z.string().trim().min(1).max(500),
    nameLocale: contentLocale,
    localizations: z.array(paletteParameterLocalizationSchema).max(32),
    required: z.boolean(),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(200),
            label: z.string().max(500),
            labelLocale: contentLocale,
            localizations: z.array(paletteOptionLocalizationSchema).max(32),
            contents: z.array(paletteContentSchema).max(200),
          })
          .passthrough(),
      )
      .min(1)
      .max(200),
  })
  .passthrough();
const contentPackPaletteEntrySchema = z
  .object({
    stableKey,
    name: z.string().trim().min(1).max(500),
    nameLocale: contentLocale,
    description: z.string().max(4_000),
    localizations: z.array(paletteLocalizationSchema).max(32),
    parameters: z.array(paletteParameterSchema).max(64),
    promptNodes: z.array(palettePromptNodeSchema).max(2_000),
    pinned: z.boolean().optional(),
  })
  .passthrough();

const contentPackPaletteSchema = z
  .object({
    schemaVersion: z.enum(['0.3.0', '0.4']),
    revision: z.string().trim().min(1).max(200),
    palettes: z.array(contentPackPaletteEntrySchema).max(10_000),
  })
  .passthrough();

async function readBoundedJson(file: ValidatedPackageFile, maximumBytes: number, label: string) {
  if (file.size === 0 || file.size > maximumBytes) {
    throw new Error(`${label} has an invalid size: ${file.path}`);
  }
  const bytes = await readFile(file.path);
  if (bytes.byteLength !== file.size || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} changed while it was being read: ${file.path}`);
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${label} contains malformed JSON: ${file.path}`);
  }
}

async function readManifest(file: ValidatedPackageFile) {
  return contentPackManifestSchema.parse(await readBoundedJson(file, MAX_MANIFEST_BYTES, 'Content pack manifest'));
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function packageFile(packagePath: string, relativePath: string, label: string) {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be package-relative`);
  const resolvedFile = path.resolve(packagePath, relativePath);
  if (!isContained(packagePath, resolvedFile)) throw new Error(`${label} is outside the content pack`);
  const entry = await lstat(resolvedFile);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  const realFile = await realpath(resolvedFile);
  if (!isContained(packagePath, realFile)) throw new Error(`${label} is outside the content pack`);
  return { path: realFile, size: entry.size };
}

async function packageDirectory(packagePath: string, relativePath: string, label: string) {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be package-relative`);
  const resolvedDirectory = path.resolve(packagePath, relativePath);
  if (!isContained(packagePath, resolvedDirectory)) throw new Error(`${label} is outside the content pack`);
  const entry = await lstat(resolvedDirectory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular directory`);
  const realDirectory = await realpath(resolvedDirectory);
  if (!isContained(packagePath, realDirectory)) throw new Error(`${label} is outside the content pack`);
  return realDirectory;
}

export async function loadContentPackPackage(packagePath: string): Promise<LoadedContentPackPackage> {
  const resolvedPackage = await realpath(packagePath);
  if (!(await lstat(resolvedPackage)).isDirectory()) throw new Error('Content pack path must be a directory');
  const manifest = await readManifest(await packageFile(resolvedPackage, 'manifest.json', 'Content pack manifest'));
  if (Boolean(manifest.source.examples) !== Boolean(manifest.source.exampleAssets)) {
    throw new Error('Content pack examples and exampleAssets must be declared together');
  }
  const [fixtureFile, dictionaryFile, paletteFile, assetsRoot, examplesFile, exampleAssetsRoot] = await Promise.all([
    packageFile(resolvedPackage, manifest.source.fixture, 'Content pack fixture'),
    packageFile(resolvedPackage, manifest.source.dictionary, 'Content pack dictionary'),
    manifest.source.palettes
      ? packageFile(resolvedPackage, manifest.source.palettes, 'Content pack palette catalog')
      : undefined,
    manifest.source.assets
      ? packageDirectory(resolvedPackage, manifest.source.assets, 'Content pack assets')
      : undefined,
    manifest.source.examples
      ? packageFile(resolvedPackage, manifest.source.examples, 'Content pack examples')
      : undefined,
    manifest.source.exampleAssets
      ? packageDirectory(resolvedPackage, manifest.source.exampleAssets, 'Content pack example assets')
      : undefined,
  ]);
  const fixturePath = fixtureFile.path;
  const dictionaryPath = dictionaryFile.path;
  const palettePath = paletteFile?.path;
  const examplesPath = examplesFile?.path;
  const [fixtureValue, dictionaryValue, paletteValue, examplesValue] = await Promise.all([
    readBoundedJson(fixtureFile, MAX_FIXTURE_BYTES, 'Content pack fixture'),
    readBoundedJson(dictionaryFile, MAX_DICTIONARY_BYTES, 'Content pack dictionary'),
    paletteFile ? readBoundedJson(paletteFile, MAX_PALETTE_BYTES, 'Content pack palette catalog') : undefined,
    examplesFile ? readBoundedJson(examplesFile, MAX_EXAMPLES_BYTES, 'Content pack examples') : undefined,
  ]);
  const fixtureDocument = parseV03FixtureDocument(fixtureValue);
  const dictionary = contentPackDictionaryIndexSchema.parse(dictionaryValue);
  const dictionaryRoot = path.dirname(dictionaryPath);
  const dictionaryTermPaths = (dictionary.termFiles ?? []).map((termFile) => {
    if (path.isAbsolute(termFile)) throw new Error('Content pack dictionary term file must be package-relative');
    return path.resolve(dictionaryRoot, termFile);
  });
  const paletteDocument = paletteValue === undefined ? undefined : contentPackPaletteSchema.parse(paletteValue);
  const examplesDocument =
    examplesValue === undefined ? undefined : contentPackExamplesDocumentSchema.parse(examplesValue);
  const [dictionaryCatalogRows, preparedExamples] = await Promise.all([
    readDictionaryImportsAsync(dictionaryTermPaths, { rootPath: dictionaryRoot }),
    prepareContentPackExamples(manifest.id, examplesDocument, exampleAssetsRoot),
  ]);
  const packageFingerprint = `sha256:${fixtureContentHash({
    contract: 'CONTENT_PACKAGE_IMPORT_SNAPSHOT_V1',
    manifest,
    fixture: fixtureDocument,
    dictionary,
    dictionaryCatalogRows,
    palette: paletteDocument ?? {},
    examples: examplesDocument ?? null,
    exampleObjects: preparedExamples.map((example) => ({
      itemKey: example.itemKey,
      objectHash: example.objectHash,
      byteSize: example.byteSize,
    })),
  })}`;
  const sourcePaths: FixturePackSourcePaths = {
    fixturePath,
    dictionaryPath,
    ...(palettePath ? { palettePath } : {}),
    supplementalItems: preparedExamples.map((example) => example.releaseItem),
    prepared: {
      fixture: fixtureDocument,
      dictionary,
      dictionaryTermPaths,
      dictionaryCatalogRows,
      palette: paletteDocument ?? {},
    },
  };
  return {
    manifest,
    packagePath: resolvedPackage,
    fixturePath,
    dictionaryPath,
    palettePath,
    assetsRoot,
    examplesPath,
    exampleAssetsRoot,
    examplesDocument,
    preparedExamples,
    packageFingerprint,
    sourcePaths,
    facetRoles: {
      ...(manifest.facetRoles?.primaryClassification
        ? { PRIMARY_CLASSIFICATION: manifest.facetRoles.primaryClassification }
        : {}),
      ...(manifest.facetRoles?.secondaryClassification
        ? { SECONDARY_CLASSIFICATION: manifest.facetRoles.secondaryClassification }
        : {}),
    },
    profile: {
      key: manifest.key,
      fixtureLibraryId: manifest.fixtureLibraryId,
      id: manifest.id,
      releaseVersion: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      contentKinds: [...manifest.contentKinds],
      defaultRoles: [...manifest.defaultRoles],
      includeInlineTerms: manifest.includeInlineTerms,
    },
  };
}

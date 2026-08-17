import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { ContentPackExample, ContentPackExamplesDocument } from '@/main/content-packs/example-manifest';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function revisionMarkerKey(packId: string) {
  const identity = packId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `content_pack_${identity}_examples_revision`;
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveExampleAsset(root: string, source: string) {
  if (path.isAbsolute(source)) throw new Error('Content pack example source must be asset-relative');
  const rootName = path.basename(root);
  const sourceRelative = source.startsWith(`${rootName}/`)
    ? source.slice(rootName.length + 1)
    : source.startsWith(`${rootName}\\`)
      ? source.slice(rootName.length + 1)
      : source;
  const candidate = path.resolve(root, sourceRelative);
  if (!isContained(root, candidate))
    throw new Error(`Content pack example source is outside the asset root: ${source}`);
  const entry = lstatSync(candidate);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error(`Content pack example source is not a regular file: ${source}`);
  const realFile = realpathSync(candidate);
  if (!isContained(root, realFile)) throw new Error(`Content pack example source is outside the asset root: ${source}`);
  return realFile;
}

function acceptedExamples(document: ContentPackExamplesDocument) {
  const accepted = document.examples.filter((example) => example.status === 'ACCEPTED');
  for (const example of accepted) {
    if (!example.mediaId || !example.evidenceId) {
      throw new Error(`Accepted content example is missing media/evidence IDs: ${example.assetId}`);
    }
  }
  return accepted as Array<ContentPackExample & { mediaId: string; evidenceId: string }>;
}

function roleFor(example: ContentPackExample) {
  if (example.role === 'NEGATIVE_EVIDENCE') {
    throw new Error(`Accepted content example cannot use NEGATIVE_EVIDENCE: ${example.assetId}`);
  }
  return example.role === 'COVER' ? 'COVER' : 'RELATED';
}

function assertUniqueIds(examples: readonly ContentPackExample[]) {
  const ids = new Map<string, string>();
  const coverTerms = new Set<string>();
  for (const example of examples) {
    if (example.role === 'COVER') {
      if (coverTerms.has(example.termStableKey)) {
        throw new Error(`Content pack examples contain multiple covers for one term: ${example.termStableKey}`);
      }
      coverTerms.add(example.termStableKey);
    }
    for (const [kind, id] of [
      ['asset', example.assetId],
      ['media', example.mediaId],
      ['evidence', example.evidenceId],
    ] as const) {
      const previous = ids.get(`${kind}:${id}`);
      if (previous && previous !== example.termStableKey) {
        throw new Error(`Content pack example ${kind} ID is reused: ${id}`);
      }
      ids.set(`${kind}:${id}`, example.termStableKey);
    }
  }
}

function rowsForIds(db: Database.Database, table: string, ids: readonly string[], activeClause: string) {
  const found = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const slots = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT id FROM ${table} WHERE id IN (${slots}) ${activeClause}`)
      .all(...chunk) as JsonMap[];
    for (const row of rows) found.add(text(row.id));
  }
  return found;
}

function assertTermsExist(db: Database.Database, examples: readonly ContentPackExample[]) {
  const stableKeys = [...new Set(examples.map((example) => example.termStableKey))];
  const found = new Set<string>();
  for (let offset = 0; offset < stableKeys.length; offset += 500) {
    const chunk = stableKeys.slice(offset, offset + 500);
    const slots = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT stable_key FROM terms WHERE stable_key IN (${slots}) AND archived_at IS NULL`)
      .all(...chunk) as JsonMap[];
    for (const row of rows) found.add(text(row.stable_key));
  }
  const missing = stableKeys.filter((stableKey) => !found.has(stableKey));
  if (missing.length)
    throw new Error(`Content pack examples reference unknown terms: ${missing.slice(0, 5).join(', ')}`);
}

export function contentPackExamplesAreCurrent(
  db: Database.Database,
  packId: string,
  document: ContentPackExamplesDocument,
) {
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(revisionMarkerKey(packId)) as
    JsonMap | undefined;
  if (text(marker?.value) !== document.revision) return false;

  const examples = acceptedExamples(document);
  const mediaIds = examples.map((example) => example.mediaId);
  const evidenceIds = examples.map((example) => example.evidenceId);
  const assetIds = examples.map((example) => example.assetId);
  return (
    rowsForIds(db, 'image_assets', assetIds, 'AND deleted_at IS NULL').size === assetIds.length &&
    rowsForIds(db, 'term_media_links', mediaIds, 'AND deleted_at IS NULL').size === mediaIds.length &&
    rowsForIds(db, 'term_evidence', evidenceIds, '').size === evidenceIds.length
  );
}

function storeExampleAsset(storage: LibraryStorage, example: ContentPackExample, sourcePath: string) {
  const existing = storage.db
    .prepare('SELECT object_hash, deleted_at FROM image_assets WHERE id = ?')
    .get(example.assetId) as JsonMap | undefined;
  if (existing && existing.deleted_at === null) return;

  const bytes = readFileSync(sourcePath);
  if (!bytes.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
    throw new Error(`Content pack example is not a PNG: ${example.source}`);
  }
  const stored = storage.storeBuffer(bytes, '.png');
  if (stored.width <= 0 || stored.height <= 0 || stored.byteSize <= 0) {
    throw new Error(`Content pack example has invalid image dimensions: ${example.source}`);
  }

  if (existing && text(existing.object_hash) !== stored.hash) {
    throw new Error(`Content pack example asset ID already belongs to another image: ${example.assetId}`);
  }
  storage.db
    .prepare(
      `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES (?, 'REFERENCE', 'EXTERNAL_IMPORT', ?, ?, ?, ?, 'image/png', ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET object_hash = excluded.object_hash,
        relative_path = excluded.relative_path, width = excluded.width, height = excluded.height,
        mime_type = excluded.mime_type, byte_size = excluded.byte_size, deleted_at = NULL`,
    )
    .run(example.assetId, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, now());
}

function retireConflictingMediaLinks(
  db: Database.Database,
  termId: string,
  assetId: string,
  mediaId: string,
  role: 'COVER' | 'RELATED',
  deletedAt: string,
) {
  const conflicts = db
    .prepare(
      `SELECT id FROM term_media_links
      WHERE term_id = ? AND deleted_at IS NULL AND id <> ?
        AND (image_asset_id = ? OR (role = 'COVER' AND ? = 'COVER'))`,
    )
    .all(termId, mediaId, assetId, role) as JsonMap[];
  for (const conflict of conflicts) {
    const conflictId = text(conflict.id);
    if (!conflictId.startsWith('term_media_dictionary_') && !conflictId.startsWith('tml_')) {
      throw new Error(`Content pack example conflicts with a local media link: ${conflictId}`);
    }
    db.prepare('UPDATE term_media_links SET deleted_at = ? WHERE id = ?').run(deletedAt, conflictId);
  }
}

export function reconcileContentPackExamples(
  storage: LibraryStorage,
  packId: string,
  document: ContentPackExamplesDocument,
  assetsRoot: string,
) {
  const examples = acceptedExamples(document);
  assertUniqueIds(examples);
  assertTermsExist(storage.db, examples);

  const resolvedSources = examples.map((example) => ({
    example,
    sourcePath: resolveExampleAsset(assetsRoot, example.source),
  }));
  const sortOrders = new Map<string, number>();
  const importedAt = now();

  for (const { example, sourcePath } of resolvedSources) {
    const role = roleFor(example);
    storeExampleAsset(storage, example, sourcePath);
    const sortOrder = sortOrders.get(example.termStableKey) ?? 0;
    sortOrders.set(example.termStableKey, sortOrder + 1);
    const term = storage.db
      .prepare('SELECT id FROM terms WHERE stable_key = ? AND archived_at IS NULL')
      .get(example.termStableKey) as JsonMap | undefined;
    if (!term) throw new Error(`Content pack example term disappeared during import: ${example.termStableKey}`);

    retireConflictingMediaLinks(storage.db, text(term.id), example.assetId, example.mediaId, role, importedAt);
    storage.db
      .prepare(
        `INSERT INTO term_media_links
        (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, 0.5, 0.5, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET term_id = excluded.term_id, image_asset_id = excluded.image_asset_id,
          role = excluded.role, sort_order = excluded.sort_order, focal_x = excluded.focal_x,
          focal_y = excluded.focal_y, deleted_at = NULL`,
      )
      .run(example.mediaId, text(term.id), example.assetId, role, sortOrder, importedAt);
    storage.db
      .prepare(
        `INSERT INTO term_evidence
        (id, term_id, image_asset_id, verdict, note, created_at)
        VALUES (?, ?, ?, 'ACCEPTED', ?, ?)
        ON CONFLICT(id) DO UPDATE SET term_id = excluded.term_id, image_asset_id = excluded.image_asset_id,
          verdict = excluded.verdict, note = excluded.note`,
      )
      .run(example.evidenceId, text(term.id), example.assetId, example.note ?? '', importedAt);
  }

  storage.db
    .prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)')
    .run(revisionMarkerKey(packId), document.revision);
}

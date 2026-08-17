import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { reconcileDictionaryCore, type PreparedDictionarySource } from '@/main/dictionary/dictionary-core';
import { reconcileWordPaletteCatalog } from '@/main/dictionary/word-palettes';
import type { PromptCommonInputDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, localized, now, text } from '@/main/database/core/values';
import {
  canonicalSnapshotJson,
  promptInputContentHash,
  promptInputSourceKind,
} from '@/main/database/generation/snapshot-content';
import {
  promptDirectTermsFromBindings,
  promptRecipesFromBindings,
} from '@/main/database/generation/prompt-binding-input';
import { readV03FixtureDocument, V03_FIXTURE_SCHEMA_VERSION } from '@/main/database/packs/fixture-contract';
import { ensureImageMaterials } from '@/main/database/albums/image-material-batch';
import { replaceTitleLocalizations } from '@/main/database/core/title-localization';

function ensureFixturePromptSnapshot(db: LibraryStorage['db'], row: JsonMap) {
  const versionId = text(row.id);
  const existing = db
    .prepare(
      `SELECT content_hash FROM prompt_input_snapshots
    WHERE prompt_version_id = ?`,
    )
    .get(versionId) as JsonMap | undefined;
  if (existing) {
    db.prepare('UPDATE prompt_versions SET content_hash = ? WHERE id = ?').run(text(existing.content_hash), versionId);
    return;
  }
  const input: PromptCommonInputDto = {
    userInstruction: text(row.userIntent),
    directTermPromptLocale: text(row.termPromptLocale) === 'zh' ? 'zh' : 'en',
    directTerms: promptDirectTermsFromBindings(db, versionId),
    recipes: promptRecipesFromBindings(db, versionId),
    directReferences: [],
    flatPrompt: text(row.finalPrompt),
  };
  const contentHash = promptInputContentHash(input);
  db.prepare(
    `INSERT INTO prompt_input_snapshots
    (id, prompt_version_id, source_kind, user_instruction, common_input_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `fixture_prompt_snapshot_${versionId}`,
    versionId,
    promptInputSourceKind(input),
    input.userInstruction,
    canonicalSnapshotJson(input),
    contentHash,
    text(row.createdAt) || now(),
  );
  db.prepare('UPDATE prompt_versions SET content_hash = ? WHERE id = ?').run(contentHash, versionId);
}

export interface FixtureReconcileOptions {
  assetsRoot?: string;
  dictionaryPath?: string;
  palettePath?: string;
  fixtureDocument?: JsonMap;
  dictionarySource?: PreparedDictionarySource;
  paletteDocument?: JsonMap;
}

export function reconcileFixture(storage: LibraryStorage, fixturePath?: string, options: FixtureReconcileOptions = {}) {
  if (!fixturePath || !existsSync(fixturePath)) return;
  const fixture = options.fixtureDocument ?? readV03FixtureDocument(fixturePath);

  reconcileFixtureRows(storage, fixture, options.assetsRoot);

  if (options.dictionaryPath) {
    reconcileDictionaryCore(storage.db, options.dictionaryPath, 'dictionary_core_revision', options.dictionarySource);
  }
  if (options.palettePath) {
    reconcileWordPaletteCatalog(
      storage.db,
      options.palettePath,
      'word_palette_catalog_revision',
      options.paletteDocument,
    );
  }
  materializeFixtureCreationOutputs(storage);
}

function materializeFixtureCreationOutputs(storage: LibraryStorage) {
  const imageAssetIds = (
    storage.db
      .prepare(
        `SELECT DISTINCT output.asset_id FROM (
          SELECT run.result_asset_id AS asset_id
          FROM generation_runs run
          JOIN prompt_versions version ON version.id = run.prompt_version_id
          JOIN prompt_series series ON series.id = version.series_id AND series.deleted_at IS NULL
          WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM generation_output_reviews review
              WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
            )
          UNION
          SELECT imported.image_asset_id
          FROM creation_output_imports imported
          JOIN prompt_series series ON series.id = imported.series_id AND series.deleted_at IS NULL
          WHERE imported.deleted_at IS NULL
          UNION
          SELECT transform.output_asset_id
          FROM image_transform_runs transform
          JOIN prompt_series series ON series.id = transform.series_id AND series.deleted_at IS NULL
          WHERE transform.deleted_at IS NULL
        ) output
        JOIN image_assets asset ON asset.id = output.asset_id AND asset.deleted_at IS NULL`,
      )
      .all() as JsonMap[]
  ).map((row) => text(row.asset_id));
  storage.db.transaction(() => ensureImageMaterials(storage, imageAssetIds)).immediate();
}

function seedFixtureTermExpression(
  db: LibraryStorage['db'],
  row: JsonMap,
  revisionTermIds: ReadonlyMap<string, string>,
) {
  const termRevisionId = text(row.termRevisionId);
  const termId = revisionTermIds.get(termRevisionId);
  const contextKey = text(row.contextKey);
  if (!termId || !contextKey) throw new Error(`Fixture term expression is missing its context: ${text(row.id)}`);
  const contextSuffix = contextKey.replace(/[^a-z0-9]+/gi, '_');
  const desiredContextProfileId = `${termId}_context_${contextSuffix}`;
  db.prepare(
    `INSERT OR IGNORE INTO term_context_profiles(id, term_id, stable_key, created_at)
    VALUES (?, ?, ?, ?)`,
  ).run(desiredContextProfileId, termId, contextKey, now());
  const storedContextProfile = db
    .prepare('SELECT id FROM term_context_profiles WHERE term_id = ? AND stable_key = ?')
    .get(termId, contextKey) as JsonMap;
  const desiredContextProfileRevisionId = `${termRevisionId}_context_${contextSuffix}`;
  db.prepare(
    `INSERT OR IGNORE INTO term_context_profile_revisions(
      id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
    ) VALUES (?, ?, ?, '', '', ?)`,
  ).run(desiredContextProfileRevisionId, storedContextProfile.id, termRevisionId, now());
  const storedContextProfileRevision = db
    .prepare(
      `SELECT id FROM term_context_profile_revisions
      WHERE context_profile_id = ? AND term_revision_id = ?`,
    )
    .get(storedContextProfile.id, termRevisionId) as JsonMap;
  db.prepare(
    `INSERT OR IGNORE INTO term_expressions(
      id, term_revision_id, context_profile_revision_id, model_key, locale,
      positive_expression, negative_expression
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, termRevisionId, storedContextProfileRevision.id, row.modelKey, row.locale, row.positive, row.negative);
}

function reconcileFixtureTermMedia(db: LibraryStorage['db'], rows: JsonMap[]) {
  for (const row of rows) {
    if (!db.prepare('SELECT 1 FROM terms WHERE id = ?').get(row.termId)) continue;
    if (!db.prepare('SELECT 1 FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(row.imageAssetId)) continue;
    db.prepare(
      `INSERT INTO term_media_links
      (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET term_id = excluded.term_id, image_asset_id = excluded.image_asset_id,
        role = excluded.role, sort_order = excluded.sort_order, focal_x = excluded.focal_x,
        focal_y = excluded.focal_y, created_at = excluded.created_at, deleted_at = NULL`,
    ).run(
      row.id,
      row.termId,
      row.imageAssetId,
      row.role,
      Number(row.sortOrder),
      Number(row.focalX ?? 0.5),
      Number(row.focalY ?? 0.5),
      text(row.createdAt) || now(),
    );
  }
}

function fixtureTitleLocalizations(row: JsonMap) {
  return (Array.isArray(row.localizations) ? row.localizations : []).map((localization) => {
    const item = localization as JsonMap;
    return { locale: text(item.locale), title: text(item.title) };
  });
}

function reconcileFixturePromptSeries(db: LibraryStorage['db'], rows: JsonMap[]) {
  for (const row of rows) {
    const title = text(row.title);
    const titleLocale = text(row.titleLocale) || 'zh';
    db.prepare(
      `INSERT INTO prompt_series
      (id, title, title_locale, current_version_id, created_at, deleted_at)
      VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, title_locale = excluded.title_locale,
        deleted_at = excluded.deleted_at`,
    ).run(row.id, title, titleLocale, row.createdAt, row.deletedAt ?? null);
    replaceTitleLocalizations(db, 'PROMPT_SERIES', text(row.id), titleLocale, fixtureTitleLocalizations(row));
  }
}

function reconcileFixtureAlbums(db: LibraryStorage['db'], rows: JsonMap[]) {
  for (const row of rows) {
    const createdAt = text(row.createdAt) || now();
    const titleLocale = text(row.titleLocale) || 'zh';
    db.prepare(
      `INSERT OR IGNORE INTO albums
      (id, title, title_locale, intent, defaults_json, pinned, created_at, updated_at, archived_at, deleted_at)
      VALUES (?, ?, ?, '', '{}', 0, ?, ?, NULL, ?)`,
    ).run(row.id, row.title, titleLocale, createdAt, createdAt, row.deletedAt ?? null);
    replaceTitleLocalizations(db, 'ALBUM', text(row.id), titleLocale, fixtureTitleLocalizations(row));
  }
}

function reconcileFixtureImageAssets(storage: LibraryStorage, rows: JsonMap[], demoAssetsRoot?: string) {
  const { db } = storage;
  const resolvedAssetsRoot = demoAssetsRoot ? path.resolve(demoAssetsRoot) : '';
  for (const row of rows) {
    let objectHash = text(row.objectHash);
    let relativePath = text(row.relativePath);
    let width = Number(row.width);
    let height = Number(row.height);
    let byteSize = Number(row.byteSize);
    const sourceRelativePath = text(row.sourcePath);
    const source = resolvedAssetsRoot && sourceRelativePath ? path.resolve(resolvedAssetsRoot, sourceRelativePath) : '';
    if (source && !source.startsWith(`${resolvedAssetsRoot}${path.sep}`)) {
      throw new Error(`Fixture asset source is outside the package: ${sourceRelativePath}`);
    }
    if (source && existsSync(source)) {
      const imported = storage.copyIntoObjectStore(source);
      objectHash = imported.hash;
      relativePath = imported.relativePath;
      width = imported.width;
      height = imported.height;
      byteSize = imported.byteSize;
    }
    db.prepare(
      `INSERT OR IGNORE INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.kind, row.originType, objectHash, relativePath, width, height, row.mimeType, byteSize, now());
  }
}

function reconcileFixtureAnnotations(db: LibraryStorage['db'], rows: JsonMap[]) {
  for (const row of rows) {
    db.prepare('INSERT OR IGNORE INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.imageAssetId,
      row.type,
      row.x,
      row.y,
      row.width ?? null,
      row.height ?? null,
      row.comment,
      row.status,
      row.createdAt,
    );
    if (row.type === 'BRUSH' && row.geometry && typeof row.geometry === 'object') {
      const geometryJson = JSON.stringify(row.geometry);
      const contentHash = createHash('sha256').update(geometryJson).digest('hex');
      db.prepare(
        `INSERT OR IGNORE INTO annotation_regions
        (annotation_id, schema_version, geometry_json, content_hash, created_at)
        VALUES (?, 1, ?, ?, ?)`,
      ).run(row.id, geometryJson, contentHash, row.createdAt);
    }
  }
}

type FixtureRows = (key: string) => JsonMap[];

function reconcileFixtureTerms(db: LibraryStorage['db'], list: FixtureRows, revisionTermIds: Map<string, string>) {
  for (const row of list('terms')) {
    db.prepare(
      `INSERT OR IGNORE INTO terms
      (id, stable_key, current_revision_id, editorial_state, archived_at)
      VALUES (?, ?, NULL, ?, ?)`,
    ).run(row.id, row.stableKey, row.editorialState, row.archivedAt ?? null);
  }
  for (const row of list('termRevisions')) {
    db.prepare(
      `INSERT OR IGNORE INTO term_revisions
      (id, term_id, revision_no, title, title_locale, definition, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.termId, row.revisionNo, row.title, row.titleLocale, row.definition ?? '', row.createdAt ?? now());
  }
  for (const row of list('terms')) {
    db.prepare('UPDATE terms SET current_revision_id = ? WHERE id = ?').run(row.currentRevisionId, row.id);
  }
  for (const row of list('facetDefinitions')) {
    const name = row.name as JsonMap;
    db.prepare(
      `INSERT OR IGNORE INTO facet_definitions
        (id, stable_key, name_zh, name_en, selection_mode, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.stableKey, localized(name, 'zh'), localized(name, 'en'), row.selectionMode, row.sortOrder);
  }
  for (const row of list('facetValues')) {
    const name = row.name as JsonMap;
    db.prepare('INSERT OR IGNORE INTO facet_values VALUES (?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.definitionId,
      row.stableKey,
      localized(name, 'zh'),
      localized(name, 'en'),
      row.sortOrder,
    );
  }
  for (const row of list('termFacetAssignments')) {
    db.prepare('INSERT OR IGNORE INTO term_facet_assignments VALUES (?, ?, ?)').run(
      row.id,
      row.termRevisionId,
      row.facetValueId,
    );
  }
  for (const row of list('termAliases')) {
    db.prepare('INSERT OR IGNORE INTO term_aliases VALUES (?, ?, ?, ?, ?)').run(
      row.id,
      row.termRevisionId,
      row.locale,
      row.value,
      row.normalizedValue,
    );
  }
  for (const row of list('termLocalizations')) {
    db.prepare('INSERT OR IGNORE INTO term_localizations VALUES (?, ?, ?, ?, ?)').run(
      row.id,
      row.termRevisionId,
      row.locale,
      row.title,
      row.definition ?? '',
    );
  }
  for (const row of list('termExpressions')) seedFixtureTermExpression(db, row, revisionTermIds);
  reconcileFixtureTermMedia(db, list('termMediaLinks'));
  for (const [bindingIndex, row] of list('promptTermBindings').entries()) {
    const termId = text(row.termId) || revisionTermIds.get(text(row.termRevisionId));
    if (!termId || !db.prepare('SELECT 1 FROM terms WHERE id = ?').get(termId)) continue;
    db.prepare(
      `INSERT INTO prompt_term_bindings
      (id, prompt_version_id, term_id, sort_order) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET prompt_version_id = excluded.prompt_version_id,
        term_id = excluded.term_id, sort_order = excluded.sort_order`,
    ).run(row.id, row.promptVersionId, termId, bindingIndex);
  }
  for (const row of list('termEvidence')) {
    db.prepare('INSERT OR IGNORE INTO term_evidence VALUES (?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.termId,
      row.imageAssetId ?? null,
      row.verdict,
      row.note ?? '',
      row.createdAt ?? now(),
    );
  }
}

function reconcileFixtureRows(storage: LibraryStorage, fixture: JsonMap, demoAssetsRoot?: string) {
  const { db } = storage;
  const list = (key: string) => (Array.isArray(fixture[key]) ? (fixture[key] as JsonMap[]) : []);
  const revisionTermIds = new Map(list('termRevisions').map((row) => [text(row.id), text(row.termId)]));
  if (list('terms').length && text(fixture.termSchemaVersion) !== '0.3.0') {
    throw new Error('Fixture term records must use schema v0.3.0');
  }

  db.transaction(() => {
    reconcileFixturePromptSeries(db, list('promptSeries'));
    reconcileFixtureImageAssets(storage, list('imageAssets'), demoAssetsRoot);
    for (const row of list('promptVersions')) {
      db.prepare(
        `INSERT INTO prompt_versions
        (id, series_id, parent_version_id, version_no, user_intent, final_prompt, change_summary, source_image_id, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET series_id = excluded.series_id,
          parent_version_id = excluded.parent_version_id, version_no = excluded.version_no,
          user_intent = excluded.user_intent, final_prompt = excluded.final_prompt,
          change_summary = excluded.change_summary, source_image_id = excluded.source_image_id,
          content_hash = excluded.content_hash, created_at = excluded.created_at`,
      ).run(
        row.id,
        row.seriesId,
        row.parentVersionId ?? null,
        row.versionNo,
        row.userIntent,
        row.finalPrompt,
        row.changeSummary,
        row.sourceImageId ?? null,
        row.contentHash,
        row.createdAt,
      );
    }
    for (const row of list('promptSeries')) {
      db.prepare('UPDATE prompt_series SET current_version_id = ? WHERE id = ?').run(row.currentVersionId, row.id);
    }
    for (const row of list('generationRuns')) {
      db.prepare(
        `INSERT INTO generation_runs
        (id, prompt_version_id, model_key, width, height, quality, status, result_asset_id, error_code, error_message, started_at, finished_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET prompt_version_id = excluded.prompt_version_id,
          model_key = excluded.model_key, width = excluded.width, height = excluded.height,
          quality = excluded.quality, status = excluded.status, result_asset_id = excluded.result_asset_id,
          error_code = excluded.error_code, error_message = excluded.error_message,
          started_at = excluded.started_at, finished_at = excluded.finished_at, created_at = excluded.created_at`,
      ).run(
        row.id,
        row.promptVersionId,
        row.modelKey,
        row.width,
        row.height,
        row.quality,
        row.status,
        row.resultAssetId ?? null,
        row.errorCode ?? null,
        row.startedAt ?? null,
        row.finishedAt ?? null,
        row.startedAt ?? now(),
      );
    }
    reconcileFixtureAnnotations(db, list('annotations'));
    reconcileFixtureTerms(db, list, revisionTermIds);
    reconcileFixtureAlbums(db, list('albums'));
    for (const row of list('albumItems')) {
      const createdAt = now();
      db.prepare(
        `INSERT INTO album_members
        (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET album_id = excluded.album_id, target_type = excluded.target_type,
          target_id = excluded.target_id, sort_order = excluded.sort_order,
          updated_at = excluded.updated_at, deleted_at = NULL`,
      ).run(
        row.id,
        row.albumId,
        text(row.targetType) === 'ALBUM' ? 'ALBUM' : 'SERIES',
        row.targetId,
        row.sortOrder,
        createdAt,
        createdAt,
      );
    }
    for (const row of list('promptVersions')) ensureFixturePromptSnapshot(db, row);
    db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('fixture_seeded', ?)").run(
      V03_FIXTURE_SCHEMA_VERSION,
    );
    db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('library_name', ?)").run(
      text((fixture.library as JsonMap | undefined)?.name) || '本地图鉴',
    );
  })();
}

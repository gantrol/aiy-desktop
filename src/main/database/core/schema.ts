import type Database from 'better-sqlite3';
import baselineSql from '@/main/database/sql/v03-baseline.sql?raw';
import revision2AiProcessSql from '@/main/database/sql/v03-revision-002-ai-process-observability.sql?raw';
import revision2PromptSourceImportSql from '@/main/database/sql/v03-revision-002-prompt-source-import.sql?raw';
import revision2LegacyTitleSql from '@/main/database/sql/v03-revision-002-title-localization-from-legacy.sql?raw';
import revision2DropLegacyTitleSql from '@/main/database/sql/v03-revision-002-drop-legacy-title-columns.sql?raw';
import revision2TermIllustrationsSql from '@/main/database/sql/v03-revision-002-term-illustrations.sql?raw';
import revision2VideoDocumentsSql from '@/main/database/sql/v03-revision-002-video-documents.sql?raw';
import revision2VideoDocumentAiActivitiesSql from '@/main/database/sql/v03-revision-002-video-document-ai-activities.sql?raw';
import revision2VideoDocumentTranslationsSql from '@/main/database/sql/v03-revision-002-video-document-translations.sql?raw';
import revision2VideoDocumentNotesSql from '@/main/database/sql/v03-revision-002-video-document-notes.sql?raw';
import revision2VideoDocumentVisualGenerationSql from '@/main/database/sql/v03-revision-002-video-document-visual-generation.sql?raw';
import revision2VideoDocumentWorkspaceSql from '@/main/database/sql/v03-revision-002-video-document-workspace.sql?raw';
import revision3CreationCoverAssetsSql from '@/main/database/sql/v03-revision-003-creation-cover-assets.sql?raw';
import revision3CreationOutputOrderSql from '@/main/database/sql/v03-revision-003-creation-output-order.sql?raw';
import revision3CreationOutputOrganizationSql from '@/main/database/sql/v03-revision-003-creation-output-organization.sql?raw';
import revision3CreationOutputPresentationSql from '@/main/database/sql/v03-revision-003-creation-output-presentation.sql?raw';
import revision4CreationItemPinnedSql from '@/main/database/sql/v03-revision-004-creation-item-pinned.sql?raw';
import revision4CreationItemsSql from '@/main/database/sql/v03-revision-004-creation-items.sql?raw';
import revision4InspirationStashesSql from '@/main/database/sql/v03-revision-004-inspiration-stashes.sql?raw';
import revision4SocialPostDraftsSql from '@/main/database/sql/v03-revision-004-social-post-drafts.sql?raw';
import revision4ArticlesSql from '@/main/database/sql/v03-revision-004-articles.sql?raw';
import revision4DerivedVisualsSql from '@/main/database/sql/v03-revision-004-derived-visuals.sql?raw';
import revision4CreationAlbumMembersSql from '@/main/database/sql/v03-revision-004-creation-album-members.sql?raw';
import {
  creationCompositionComplete,
  ensureCreationEntityComposition,
  ensureCreationItemLocations,
} from '@/main/database/creations/creation-composition-schema';
import {
  contentLifecycleShape,
  ensureContentLifecycle,
  ensureRecoveryLifecycle,
  recoveryLifecycleShape,
} from '@/main/database/recovery/content-lifecycle-schema';

export const DATABASE_PRODUCT_BASELINE = '0.3.0';
// v0.3.6 advances the public schema exactly once from revision 3 to revision 4.
// Do not number individual unreleased features separately.
export const DATABASE_SCHEMA_REVISION = 4;
const DATABASE_SHUTDOWN_STATE_KEY = 'database_shutdown_state';

const releasedRevision1RequiredTables = [
  'albums',
  'app_meta',
  'background_jobs',
  'creation_output_imports',
  'creation_drafts',
  'creator_agent_turns',
  'file_projection_links',
  'local_spaces',
  'materials',
  'packs',
  'prompt_series',
  'term_categories',
  'term_context_profiles',
  'term_revision_categories',
  'terms',
  'word_palette_revision_content_nodes',
  'word_palette_revisions',
] as const;

const localizedRequiredTables = [
  ...releasedRevision1RequiredTables,
  'album_localizations',
  'ai_process_attempts',
  'ai_process_context_turns',
  'ai_process_events',
  'ai_process_external_refs',
  'ai_processes',
  'prompt_series_localizations',
] as const;

const termIllustrationRequiredTables = [
  ...localizedRequiredTables,
  'term_illustration_batch_runs',
  'term_illustration_batches',
] as const;

const revision2RequiredTables = [
  ...termIllustrationRequiredTables,
  'document_branches',
  'document_draft_revisions',
  'document_drafts',
  'document_source_relations',
  'document_thumbnails',
  'documents',
  'video_assets',
  'video_document_generation_runs',
  'video_document_navigation_order',
  'video_document_transcription_runs',
  'video_document_translation_runs',
] as const;

const currentRequiredTables = [
  ...revision2RequiredTables,
  'article_revisions',
  'articles',
  'creation_forms',
  'creation_items',
  'content_lifecycle_batch_members',
  'content_lifecycle_batches',
  'derived_visuals',
  'inspiration_stashes',
  'prompt_series_cover_assets',
  'prompt_series_output_exclusions',
  'recycle_bin_entries',
  'social_post_drafts',
  'social_post_revisions',
] as const;

const canonicalTitleColumns = [
  { table: 'albums', columns: ['title', 'title_locale'] },
  { table: 'creation_drafts', columns: ['title'] },
  { table: 'prompt_series', columns: ['title', 'title_locale'] },
] as const;

const currentVideoWorkspaceColumns = [
  {
    table: 'video_assets',
    columns: ['audio_status', 'audio_track_count', 'audio_primary_codec', 'audio_detected_at', 'audio_error_code'],
  },
  { table: 'video_document_generation_runs', columns: ['error_detail_json'] },
] as const;

const releasedRevision1TitleColumns = [
  { table: 'albums', required: ['title'], forbidden: ['title_locale'] },
  { table: 'creation_drafts', required: ['title_zh', 'title_en'], forbidden: ['title'] },
  { table: 'prompt_series', required: ['title', 'title_zh', 'title_en'], forbidden: ['title_locale'] },
] as const;

const retiredTitleColumns = [
  { table: 'creation_drafts', columns: ['title_zh', 'title_en'] },
  { table: 'prompt_series', columns: ['title_zh', 'title_en'] },
] as const;

function tableNames(db: Database.Database) {
  return new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
}

function metadata(db: Database.Database, key: string) {
  if (!tableNames(db).has('app_meta')) return undefined;
  return db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(key);
}

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function assertRequiredTables(db: Database.Database, requiredTables: readonly string[]) {
  const tables = tableNames(db);
  if (requiredTables.some((table) => !tables.has(table))) unsupportedSchema();
}

function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function assertCanonicalTitleColumns(db: Database.Database) {
  for (const requirement of canonicalTitleColumns) {
    const columns = columnNames(db, requirement.table);
    if (requirement.columns.some((column) => !columns.has(column))) unsupportedSchema();
  }
}

function assertCurrentVideoWorkspaceColumns(db: Database.Database) {
  for (const requirement of currentVideoWorkspaceColumns) {
    const columns = columnNames(db, requirement.table);
    if (requirement.columns.some((column) => !columns.has(column))) unsupportedSchema();
  }
}

function hasPromptVersionSourceImportColumn(db: Database.Database) {
  return columnNames(db, 'prompt_versions').has('source_import_id');
}

function ensurePromptVersionSourceImportColumn(db: Database.Database) {
  if (!hasPromptVersionSourceImportColumn(db)) db.exec(revision2PromptSourceImportSql);
}

function hasCreationOutputSortOrderColumn(db: Database.Database) {
  return columnNames(db, 'creation_output_imports').has('sort_order');
}

function ensureCreationOutputSortOrderColumn(db: Database.Database) {
  if (!hasCreationOutputSortOrderColumn(db)) db.exec(revision3CreationOutputOrderSql);
}

function creationOutputOrganizationShape(db: Database.Database) {
  const columns = columnNames(db, 'creation_output_imports');
  const states = ['relationship_kind', 'relationship_target_output_id'].map((column) => columns.has(column));
  if (states.every(Boolean)) return 'COMPLETE' as const;
  if (states.every((present) => !present)) return 'ABSENT' as const;
  unsupportedSchema();
}

function hasCreationOutputOrganizationColumns(db: Database.Database) {
  return creationOutputOrganizationShape(db) === 'COMPLETE';
}

function ensureCreationOutputOrganizationColumns(db: Database.Database) {
  if (creationOutputOrganizationShape(db) === 'ABSENT') db.exec(revision3CreationOutputOrganizationSql);
}

function creationOutputPresentationShape(db: Database.Database) {
  const tables = tableNames(db);
  const exclusionTablePresent = tables.has('prompt_series_output_exclusions');
  const coverTablePresent = tables.has('prompt_series_cover_assets');
  const columnPresent = columnNames(db, 'prompt_series').has('cover_image_asset_id');
  if (exclusionTablePresent && columnPresent && coverTablePresent) return 'COMPLETE' as const;
  if (exclusionTablePresent && columnPresent && !coverTablePresent) return 'SINGLE_COVER_DEVELOPMENT' as const;
  if (!exclusionTablePresent && !columnPresent && !coverTablePresent) return 'ABSENT' as const;
  unsupportedSchema();
}

function ensureCreationOutputPresentation(db: Database.Database) {
  const shape = creationOutputPresentationShape(db);
  if (shape === 'ABSENT') db.exec(revision3CreationOutputPresentationSql);
  if (shape !== 'COMPLETE') db.exec(revision3CreationCoverAssetsSql);
}

function creationLibraryShape(db: Database.Database) {
  const tables = tableNames(db);
  const itemsPresent = tables.has('creation_items');
  const formsPresent = tables.has('creation_forms');
  if (!itemsPresent && !formsPresent) return 'ABSENT' as const;
  if (!itemsPresent || !formsPresent) unsupportedSchema();

  const itemColumns = columnNames(db, 'creation_items');
  const formColumns = columnNames(db, 'creation_forms');
  const requiredItemColumns = [
    'id',
    'phase',
    'primary_form_id',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  const requiredFormColumns = [
    'id',
    'creation_item_id',
    'role',
    'entity_type',
    'entity_id',
    'anchor_key',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ];
  const indexes = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'creation_forms'").all() as Array<{
        name: string;
      }>
    ).map((index) => index.name),
  );
  const requiredIndexes = [
    'idx_creation_forms_active_entity',
    'idx_creation_forms_active_singleton_role',
    'idx_creation_forms_active_article_inline_anchor',
  ];
  if (
    requiredItemColumns.every((column) => itemColumns.has(column)) &&
    requiredFormColumns.every((column) => formColumns.has(column)) &&
    requiredIndexes.every((index) => indexes.has(index))
  ) {
    return itemColumns.has('pinned') ? ('COMPLETE' as const) : ('MISSING_PINNED' as const);
  }
  unsupportedSchema();
}

function ensureCreationLibrary(db: Database.Database) {
  const shape = creationLibraryShape(db);
  if (shape === 'ABSENT') db.exec(revision4CreationItemsSql);
  if (shape === 'MISSING_PINNED') db.exec(revision4CreationItemPinnedSql);
}

function inspirationStashShape(db: Database.Database) {
  if (!tableNames(db).has('inspiration_stashes')) return 'ABSENT' as const;
  const columns = columnNames(db, 'inspiration_stashes');
  const required = [
    'id',
    'album_id',
    'input_json',
    'content_hash',
    'status',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  if (!required.every((column) => columns.has(column))) unsupportedSchema();
  if (columns.has('parent_series_id')) return 'LEGACY_PARENT_SERIES' as const;
  return 'COMPLETE' as const;
}

function ensureInspirationStashes(db: Database.Database) {
  if (inspirationStashShape(db) === 'ABSENT') db.exec(revision4InspirationStashesSql);
}

function socialPostDraftShape(db: Database.Database) {
  const tables = tableNames(db);
  const draftPresent = tables.has('social_post_drafts');
  const revisionPresent = tables.has('social_post_revisions');
  if (!draftPresent && !revisionPresent) return 'ABSENT' as const;
  if (!draftPresent || !revisionPresent) unsupportedSchema();
  const draftColumns = columnNames(db, 'social_post_drafts');
  const revisionColumns = columnNames(db, 'social_post_revisions');
  const draftRequired = [
    'id',
    'album_id',
    'source_inspiration_stash_id',
    'current_revision_id',
    'status',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  const revisionRequired = ['id', 'draft_id', 'revision_no', 'content_json', 'content_hash', 'created_at'];
  if (
    draftRequired.every((column) => draftColumns.has(column)) &&
    revisionRequired.every((column) => revisionColumns.has(column))
  ) {
    return 'COMPLETE' as const;
  }
  unsupportedSchema();
}

function ensureSocialPostDrafts(db: Database.Database) {
  if (socialPostDraftShape(db) === 'ABSENT') db.exec(revision4SocialPostDraftsSql);
}

function articleShape(db: Database.Database) {
  const tables = tableNames(db);
  const articlePresent = tables.has('articles');
  const revisionPresent = tables.has('article_revisions');
  if (!articlePresent && !revisionPresent) return 'ABSENT' as const;
  if (!articlePresent || !revisionPresent) unsupportedSchema();
  const articleColumns = columnNames(db, 'articles');
  const revisionColumns = columnNames(db, 'article_revisions');
  const articleRequired = [
    'id',
    'album_id',
    'source_inspiration_stash_id',
    'current_revision_id',
    'status',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  const revisionRequired = ['id', 'article_id', 'revision_no', 'content_json', 'content_hash', 'created_at'];
  if (
    articleRequired.every((column) => articleColumns.has(column)) &&
    revisionRequired.every((column) => revisionColumns.has(column))
  ) {
    return 'COMPLETE' as const;
  }
  unsupportedSchema();
}

function ensureArticles(db: Database.Database) {
  if (articleShape(db) === 'ABSENT') db.exec(revision4ArticlesSql);
}

function derivedVisualShape(db: Database.Database) {
  if (!tableNames(db).has('derived_visuals')) return 'ABSENT' as const;
  const columns = columnNames(db, 'derived_visuals');
  const required = [
    'id',
    'role',
    'article_id',
    'article_revision_id',
    'social_post_id',
    'social_post_revision_id',
    'anchor_json',
    'creation_draft_id',
    'prompt_series_id',
    'selected_image_asset_id',
    'created_at',
    'updated_at',
    'adopted_at',
  ];
  if (required.every((column) => columns.has(column))) return 'COMPLETE' as const;
  unsupportedSchema();
}

function ensureDerivedVisuals(db: Database.Database) {
  if (derivedVisualShape(db) === 'ABSENT') db.exec(revision4DerivedVisualsSql);
}

function creationAlbumOwnershipShape(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'album_members'").get() as
    { sql?: unknown } | undefined;
  const tableSql = row?.sql;
  if (typeof tableSql !== 'string') unsupportedSchema();
  const rootOrderRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sidebar_root_order'")
    .get() as { sql?: unknown } | undefined;
  const rootOrderSql = rootOrderRow?.sql;
  if (typeof rootOrderSql !== 'string') unsupportedSchema();

  const indexes = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'album_members'").all() as Array<{
        name: string;
      }>
    ).map((index) => index.name),
  );
  const rootOrderIndexes = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sidebar_root_order'")
        .all() as Array<{ name: string }>
    ).map((index) => index.name),
  );
  if (
    tableSql.includes("'CREATION_ITEM'") &&
    rootOrderSql.includes("'CREATION_ITEM'") &&
    indexes.has('idx_album_members_active_creation_item_owner')
  ) {
    return rootOrderIndexes.has('idx_sidebar_root_order_sort')
      ? ('COMPLETE' as const)
      : ('MISSING_ROOT_ORDER_INDEX' as const);
  }

  if (tableSql.includes("'CREATION_ITEM'") || rootOrderSql.includes("'CREATION_ITEM'")) unsupportedSchema();
  const legacyTypes = ['SERIES', 'DOCUMENT'];
  const developmentTypes = ['INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE'];
  const hasAnyDevelopmentType = developmentTypes.some((targetType) => tableSql.includes(`'${targetType}'`));
  if (
    legacyTypes.every((targetType) => tableSql.includes(`'${targetType}'`)) &&
    (!hasAnyDevelopmentType || developmentTypes.every((targetType) => tableSql.includes(`'${targetType}'`))) &&
    rootOrderSql.includes("'SERIES'")
  ) {
    return 'ENTITY_MEMBERS' as const;
  }
  unsupportedSchema();
}

function ensureCreationItemAlbumOwnership(db: Database.Database) {
  const shape = creationAlbumOwnershipShape(db);
  if (shape === 'ENTITY_MEMBERS') db.exec(revision4CreationAlbumMembersSql);
  if (shape === 'MISSING_ROOT_ORDER_INDEX') {
    db.exec(
      'CREATE INDEX idx_sidebar_root_order_sort ON sidebar_root_order(scope, sort_order, target_type, target_id)',
    );
  }
}

function videoDocumentGenerationSupportsVisualInput(db: Database.Database) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'video_document_generation_runs'")
    .get() as { sql?: unknown } | undefined;
  return (
    typeof row?.sql === 'string' && /\(status\s*=\s*'RUNNING'\s+AND\s+output_revision_id\s+IS\s+NULL/i.test(row.sql)
  );
}

function ensureVideoDocumentGenerationSupportsVisualInput(db: Database.Database) {
  if (!videoDocumentGenerationSupportsVisualInput(db)) db.exec(revision2VideoDocumentVisualGenerationSql);
}

function videoDocumentBranchesSupportNotes(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_branches'").get() as
    { sql?: unknown } | undefined;
  return typeof row?.sql === 'string' && /'NOTES'/i.test(row.sql);
}

function ensureVideoDocumentBranchesSupportNotes(db: Database.Database) {
  if (!videoDocumentBranchesSupportNotes(db)) db.exec(revision2VideoDocumentNotesSql);
}

function videoDocumentTranscriptionRunsAvailable(db: Database.Database) {
  return tableNames(db).has('video_document_transcription_runs');
}

function ensureVideoDocumentTranscriptionRuns(db: Database.Database) {
  if (!videoDocumentTranscriptionRunsAvailable(db)) db.exec(revision2VideoDocumentAiActivitiesSql);
}

function videoDocumentTranslationRunsAvailable(db: Database.Database) {
  return tableNames(db).has('video_document_translation_runs');
}

function ensureVideoDocumentTranslationRuns(db: Database.Database) {
  if (!videoDocumentTranslationRunsAvailable(db)) db.exec(revision2VideoDocumentTranslationsSql);
}

function retiredTitleColumnShape(db: Database.Database) {
  const states = retiredTitleColumns.flatMap((requirement) => {
    const columns = columnNames(db, requirement.table);
    return requirement.columns.map((column) => columns.has(column));
  });
  if (states.every(Boolean)) return 'PRESENT' as const;
  if (states.every((present) => !present)) return 'ABSENT' as const;
  unsupportedSchema();
}

function legacyTitleCleanupError(reason: string): never {
  throw new Error(`Cannot retire legacy title columns: ${reason}`);
}

function assertLegacyTitlesCopied(db: Database.Database) {
  const conflictingDraft = db
    .prepare(
      `SELECT id FROM creation_drafts
      WHERE length(trim(COALESCE(title_zh, ''))) > 0
        AND length(trim(COALESCE(title_en, ''))) > 0
        AND title_zh <> title_en
      LIMIT 1`,
    )
    .get() as { id: unknown } | undefined;
  if (conflictingDraft) {
    legacyTitleCleanupError(`creation draft ${String(conflictingDraft.id)} has two distinct non-empty titles`);
  }

  const mismatchedDraft = db
    .prepare(
      `SELECT id FROM creation_drafts
      WHERE title <> CASE
        WHEN length(trim(COALESCE(title_zh, ''))) > 0 THEN title_zh
        WHEN length(trim(COALESCE(title_en, ''))) > 0 THEN title_en
        ELSE ''
      END
      LIMIT 1`,
    )
    .get() as { id: unknown } | undefined;
  if (mismatchedDraft) {
    legacyTitleCleanupError(`creation draft ${String(mismatchedDraft.id)} was not copied to title`);
  }

  for (const locale of ['zh', 'en'] as const) {
    const legacyColumn = `title_${locale}`;
    const unrepresentedSeries = db
      .prepare(
        `SELECT series.id
        FROM prompt_series series
        WHERE length(trim(COALESCE(series.${legacyColumn}, ''))) > 0
          AND NOT (
            (series.title_locale = ? AND series.title = series.${legacyColumn})
            OR EXISTS (
              SELECT 1 FROM prompt_series_localizations localization
              WHERE localization.prompt_series_id = series.id
                AND localization.locale = ?
                AND localization.title = series.${legacyColumn}
            )
          )
        LIMIT 1`,
      )
      .get(locale, locale) as { id: unknown } | undefined;
    if (unrepresentedSeries) {
      legacyTitleCleanupError(`prompt series ${String(unrepresentedSeries.id)} has an unrepresented ${locale} title`);
    }
  }
}

function revision1TitleShape(db: Database.Database) {
  const tables = tableNames(db);
  const hasAlbumLocalizations = tables.has('album_localizations');
  const hasPromptSeriesLocalizations = tables.has('prompt_series_localizations');

  const isReleasedShape =
    !hasAlbumLocalizations &&
    !hasPromptSeriesLocalizations &&
    releasedRevision1TitleColumns.every((requirement) => {
      const columns = columnNames(db, requirement.table);
      return (
        requirement.required.every((column) => columns.has(column)) &&
        requirement.forbidden.every((column) => !columns.has(column))
      );
    });
  if (isReleasedShape) return 'RELEASED_LEGACY' as const;

  const isAlreadyLocalizedShape =
    hasAlbumLocalizations &&
    hasPromptSeriesLocalizations &&
    canonicalTitleColumns.every((requirement) => {
      const columns = columnNames(db, requirement.table);
      return requirement.columns.every((column) => columns.has(column));
    });
  if (isAlreadyLocalizedShape) return 'ALREADY_LOCALIZED' as const;

  unsupportedSchema();
}

const preVideoWorkspaceRequiredTables = revision2RequiredTables.filter(
  (table) =>
    table !== 'video_document_navigation_order' &&
    table !== 'video_document_transcription_runs' &&
    table !== 'video_document_translation_runs',
);
const preVideoDocumentAiActivityRequiredTables = revision2RequiredTables.filter(
  (table) => table !== 'video_document_transcription_runs' && table !== 'video_document_translation_runs',
);
// Recovery-only markers emitted by private builds before the next public
// revision was consolidated. They are never written by the final schema.
const unreleasedDevelopmentStages = [2, 3, 4, 5, 6] as const;
type UnreleasedDevelopmentStage = (typeof unreleasedDevelopmentStages)[number];

function isCurrentSchemaShapeBeforePromptSourceImport(db: Database.Database) {
  try {
    assertRequiredTables(db, preVideoDocumentAiActivityRequiredTables);
    assertCanonicalTitleColumns(db);
    assertCurrentVideoWorkspaceColumns(db);
    return retiredTitleColumnShape(db) === 'ABSENT';
  } catch {
    return false;
  }
}

function isRevision2SchemaShape(db: Database.Database) {
  return (
    isCurrentSchemaShapeBeforePromptSourceImport(db) &&
    hasPromptVersionSourceImportColumn(db) &&
    videoDocumentGenerationSupportsVisualInput(db) &&
    videoDocumentBranchesSupportNotes(db) &&
    videoDocumentTranscriptionRunsAvailable(db) &&
    videoDocumentTranslationRunsAvailable(db)
  );
}

function isRevision3SchemaShape(db: Database.Database) {
  return (
    isRevision2SchemaShape(db) &&
    hasCreationOutputSortOrderColumn(db) &&
    hasCreationOutputOrganizationColumns(db) &&
    creationOutputPresentationShape(db) === 'COMPLETE'
  );
}

function isCurrentSchemaShape(db: Database.Database) {
  return (
    isRevision3SchemaShape(db) &&
    creationLibraryShape(db) === 'COMPLETE' &&
    inspirationStashShape(db) === 'COMPLETE' &&
    socialPostDraftShape(db) === 'COMPLETE' &&
    articleShape(db) === 'COMPLETE' &&
    derivedVisualShape(db) === 'COMPLETE' &&
    creationAlbumOwnershipShape(db) === 'COMPLETE' &&
    creationCompositionComplete(db) &&
    recoveryLifecycleShape(db) === 'COMPLETE' &&
    contentLifecycleShape(db) === 'COMPLETE'
  );
}

function retireLegacyTitles(db: Database.Database) {
  assertRequiredTables(db, localizedRequiredTables);
  assertCanonicalTitleColumns(db);
  const retiredShape = retiredTitleColumnShape(db);
  if (retiredShape === 'PRESENT') {
    assertLegacyTitlesCopied(db);
    db.exec(revision2DropLegacyTitleSql);
    if (retiredTitleColumnShape(db) !== 'ABSENT') unsupportedSchema();
  }
}

/**
 * Finish the single public revision-2 schema from a known intermediate shape.
 *
 * Values 2-6 were written only by unreleased development builds. They are
 * stages, not public revisions: accepting them here preserves local developer
 * libraries while normalizing the old shape to public revision 2 before the
 * revision-3 migration is applied.
 */
function finishRevision2FromDevelopmentStage(db: Database.Database, stage: UnreleasedDevelopmentStage) {
  if (isRevision2SchemaShape(db)) return;
  // Some private revision-2 builds already produced the complete table shape.
  // Complete the newly consolidated nullable column without replaying the
  // earlier, non-idempotent development-stage migrations.
  if (stage === 2 && isCurrentSchemaShapeBeforePromptSourceImport(db)) {
    ensureVideoDocumentGenerationSupportsVisualInput(db);
    ensurePromptVersionSourceImportColumn(db);
    ensureVideoDocumentBranchesSupportNotes(db);
    ensureVideoDocumentTranscriptionRuns(db);
    ensureVideoDocumentTranslationRuns(db);
    if (!isRevision2SchemaShape(db)) unsupportedSchema();
    return;
  }

  if (stage <= 2) retireLegacyTitles(db);
  if (stage <= 3) {
    assertRequiredTables(db, localizedRequiredTables);
    db.exec(revision2TermIllustrationsSql);
  }
  if (stage <= 4) {
    assertRequiredTables(db, termIllustrationRequiredTables);
    db.exec(revision2VideoDocumentsSql);
  }
  if (stage <= 5) {
    assertRequiredTables(db, preVideoWorkspaceRequiredTables);
    db.exec(revision2VideoDocumentWorkspaceSql);
  }
  ensureVideoDocumentGenerationSupportsVisualInput(db);
  ensurePromptVersionSourceImportColumn(db);
  ensureVideoDocumentBranchesSupportNotes(db);
  ensureVideoDocumentTranscriptionRuns(db);
  ensureVideoDocumentTranslationRuns(db);
  if (!isRevision2SchemaShape(db)) unsupportedSchema();
}

function migrateReleasedDatabase(db: Database.Database) {
  if (metadata(db, 'product_data_baseline') !== DATABASE_PRODUCT_BASELINE) unsupportedSchema();

  const storedRevision = Number(metadata(db, 'database_schema_revision'));
  const isReleasedBaseline = storedRevision === 1 || storedRevision === 2;
  const isUnreleasedDevelopmentStage = unreleasedDevelopmentStages.some((stage) => stage === storedRevision);
  if (!Number.isSafeInteger(storedRevision) || (!isReleasedBaseline && !isUnreleasedDevelopmentStage)) {
    unsupportedSchema();
  }
  if (storedRevision === DATABASE_SCHEMA_REVISION && isCurrentSchemaShape(db)) return false;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (storedRevision === 1) {
        assertRequiredTables(db, releasedRevision1RequiredTables);
        const titleShape = revision1TitleShape(db);
        if (titleShape === 'RELEASED_LEGACY') db.exec(revision2LegacyTitleSql);
        db.exec(revision2AiProcessSql);
        finishRevision2FromDevelopmentStage(db, 2);
      } else {
        finishRevision2FromDevelopmentStage(db, storedRevision as UnreleasedDevelopmentStage);
      }
      ensureCreationOutputSortOrderColumn(db);
      ensureCreationOutputOrganizationColumns(db);
      ensureCreationOutputPresentation(db);
      ensureCreationLibrary(db);
      ensureInspirationStashes(db);
      ensureSocialPostDrafts(db);
      ensureArticles(db);
      ensureDerivedVisuals(db);
      ensureCreationEntityComposition(db);
      ensureCreationItemAlbumOwnership(db);
      ensureCreationItemLocations(db);
      ensureRecoveryLifecycle(db);
      ensureContentLifecycle(db);
      if (!isCurrentSchemaShape(db)) unsupportedSchema();

      if (storedRevision !== DATABASE_SCHEMA_REVISION) {
        const result = db
          .prepare("UPDATE app_meta SET value = ? WHERE key = 'database_schema_revision' AND value = ?")
          .run(String(DATABASE_SCHEMA_REVISION), String(storedRevision));
        if (result.changes !== 1) throw new Error('Database schema revision changed while applying a migration');
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return true;
}

/**
 * Cheap release-baseline gate used by every process that opens the library.
 *
 * AIY 0.3.0 is the immutable product baseline. Numbered schema revisions may
 * move that released baseline forward, while pre-release and unknown database
 * identities remain unsupported and are never rewritten.
 */
export function assertDatabaseSchemaCompatible(db: Database.Database) {
  assertRequiredTables(db, currentRequiredTables);
  assertCanonicalTitleColumns(db);
  assertCurrentVideoWorkspaceColumns(db);
  if (!videoDocumentGenerationSupportsVisualInput(db)) unsupportedSchema();
  if (!videoDocumentBranchesSupportNotes(db)) unsupportedSchema();
  if (!videoDocumentTranscriptionRunsAvailable(db)) unsupportedSchema();
  if (!videoDocumentTranslationRunsAvailable(db)) unsupportedSchema();
  if (!hasPromptVersionSourceImportColumn(db)) unsupportedSchema();
  if (!hasCreationOutputSortOrderColumn(db)) unsupportedSchema();
  if (!hasCreationOutputOrganizationColumns(db)) unsupportedSchema();
  if (creationOutputPresentationShape(db) !== 'COMPLETE') unsupportedSchema();
  if (creationLibraryShape(db) !== 'COMPLETE') unsupportedSchema();
  if (inspirationStashShape(db) !== 'COMPLETE') unsupportedSchema();
  if (socialPostDraftShape(db) !== 'COMPLETE') unsupportedSchema();
  if (articleShape(db) !== 'COMPLETE') unsupportedSchema();
  if (derivedVisualShape(db) !== 'COMPLETE') unsupportedSchema();
  if (creationAlbumOwnershipShape(db) !== 'COMPLETE') unsupportedSchema();
  if (!creationCompositionComplete(db)) unsupportedSchema();
  if (recoveryLifecycleShape(db) !== 'COMPLETE') unsupportedSchema();
  if (contentLifecycleShape(db) !== 'COMPLETE') unsupportedSchema();
  if (retiredTitleColumnShape(db) !== 'ABSENT') unsupportedSchema();
  if (metadata(db, 'product_data_baseline') !== DATABASE_PRODUCT_BASELINE) unsupportedSchema();
  if (Number(metadata(db, 'database_schema_revision')) !== DATABASE_SCHEMA_REVISION) unsupportedSchema();
}

/** Expensive whole-database validation run by the primary library initializer. */
export function verifyDatabaseIntegrity(db: Database.Database) {
  const integrity = db.prepare('PRAGMA integrity_check').pluck().get();
  if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${String(integrity)}`);
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('Database foreign-key check failed');
}

export function initializeDatabaseSchema(db: Database.Database) {
  const created = tableNames(db).size === 0;
  if (created) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => db.exec(baselineSql))();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else {
    db.pragma('foreign_keys = ON');
  }
  // Keep the shipped baseline immutable: empty and existing libraries advance
  // through the same atomic forward-only revision.
  const migrated = migrateReleasedDatabase(db);

  assertDatabaseSchemaCompatible(db);
  const previousShutdownWasClean = metadata(db, DATABASE_SHUTDOWN_STATE_KEY) === 'clean';
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(DATABASE_SHUTDOWN_STATE_KEY, 'dirty');

  if (created || migrated || !previousShutdownWasClean) verifyDatabaseIntegrity(db);
}

export function markDatabaseCleanShutdown(db: Database.Database) {
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(DATABASE_SHUTDOWN_STATE_KEY, 'clean');
}

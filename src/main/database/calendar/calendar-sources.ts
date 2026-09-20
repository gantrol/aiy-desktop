import type Database from 'better-sqlite3';
import type { CalendarCategory, CalendarEntityRef } from '@/shared/contracts/calendar';
import { packSyncSummarySchema, type PackSyncSummary } from '@/shared/pack-sync';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { creationImageSourceFormsSql } from '@/main/database/creations/creation-image-source-sql';
import {
  calendarParentQuery,
  calendarParentSources,
  calendarSourceAliases,
} from '@/main/database/calendar/calendar-object-sources';

const categoryTypes: Record<Exclude<CalendarCategory, 'other'>, readonly string[]> = {
  content: [
    'ARTICLE',
    'ARTICLE_REVISION',
    'ARTICLE_COMMENT',
    'SOCIAL_POST',
    'SOCIAL_POST_DRAFT',
    'SOCIAL_POST_REVISION',
    'CREATION',
    'CREATION_ACTIVITY_EVENT',
    'CREATION_DRAFT',
    'CREATION_INPUT_STASH',
    'CREATION_ITEM',
    'CREATION_FORM',
    'CREATION_ELEMENT',
    'CREATION_OUTPUT_IMPORT',
    'PROMPT_SERIES',
    'PROMPT_VERSION',
    'IMAGE_ASSET',
    'VIDEO_ASSET',
    'MATERIAL',
    'EXTERNAL_MATERIAL_METADATA',
    'INSPIRATION_STASH',
    'DERIVED_VISUAL',
    'IMAGE_BREAKDOWN',
    'ANNOTATION',
    'IMAGE_RATING',
    'IMAGE_TRANSFORM',
    'DOCUMENT',
    'DOCUMENT_BRANCH',
    'DOCUMENT_DRAFT',
    'DOCUMENT_DRAFT_REVISION',
    'DOCUMENT_THUMBNAIL',
    'CONTENT_REFERENCE',
    'GIF_DOCUMENT',
    'EVALUATION_SUITE',
    'EVALUATION_SUITE_REVISION',
    'GENERATION_OUTPUT_REVIEW',
  ],
  organization: ['ALBUM', 'ALBUM_MEMBER', 'MATERIAL_FAVORITE', 'DOCUMENT_SOURCE_RELATION', 'VIDEO_DOCUMENT_NAVIGATION'],
  knowledge: [
    'TERM',
    'TERM_REVISION',
    'TERM_CATEGORY',
    'TERM_MEDIA_LINK',
    'TERM_ILLUSTRATION_BATCH',
    'TERM_ILLUSTRATION_RUN',
    'WORD_PALETTE',
    'DICTIONARY_MAINTENANCE_REPORT',
    'KNOWLEDGE_DISTILLATION_PROPOSAL',
    'LOCAL_OVERRIDE',
  ],
  ai: [
    'GENERATION_RUN',
    'GENERATION_EDIT_SPEC',
    'ASSISTANT_RUN',
    'ASSISTANT_PROPOSAL',
    'ASSISTANT_PROPOSAL_APPLICATION',
    'CREATOR_AGENT_TURN',
    'AI_PROCESS',
    'AI_PROCESS_EVENT',
    'AGENT_TASK',
    'AGENT_COMMAND',
    'AGENT_GENERATION_JOB',
    'STYLE_EXPLORATION_BATCH',
    'STYLE_EXPLORATION_SLOT',
    'ARTICLE_CHECK_RUN',
    'HISTORICAL_TERM_RECOMMENDATION_RUN',
    'VIDEO_DOCUMENT_GENERATION_RUN',
    'VIDEO_DOCUMENT_TRANSCRIPTION_RUN',
    'VIDEO_DOCUMENT_TRANSLATION_RUN',
    'BACKGROUND_JOB',
    'CODEX_CONTENT_TASK',
    'GIF_GENERATION_RUN',
  ],
  delivery: [
    'ARTICLE_DELIVERY_JOB',
    'DELIVERY_JOB',
    'DELIVERY_ATTEMPT',
    'DELIVERY_RECEIPT',
    'BROWSER_HANDOFF',
    'GIF_EXPORT_RUN',
  ],
  workspace: [
    'LOCAL_SPACE',
    'SIDEBAR_ROOT_ORDER',
    'DESKTOP_NOTE',
    'DESKTOP_NOTE_INSTANCE',
    'DESKTOP_CONTENT_PIN',
    'PETAL_LAYER',
    'PETAL_MEMBERSHIP',
    'PACK',
    'PACK_SYNC_RUN',
    'PACK_RELEASE',
    'PACK_INSTALLATION',
    'PACK_INSTALL_ATTEMPT',
    'PACK_OBJECT_LINK',
    'CONTEXT_PACK_ACTIVATION',
    'EXTENSION',
    'BACKGROUND_ISSUE_ACKNOWLEDGEMENT',
  ],
};
export const calendarCategorySql = `CASE ${Object.entries(categoryTypes)
  .map(([category, types]) => `WHEN entity_type IN (${types.map((type) => `'${type}'`).join(',')}) THEN '${category}'`)
  .join(' ')} ELSE 'other' END`;

interface SourceQuery {
  from: string;
  key: string;
  select: string;
  available?: string;
  joins?: string;
  ctes?: string;
}

const namedSource = (from: string, select = 'title', available = 'deleted_at IS NULL'): SourceQuery => ({
  from,
  key: 'id',
  select,
  available,
});
const revisionSource = (table: string, revisions: string): SourceQuery => ({
  from: `${table} a`,
  key: 'a.id',
  select: "CASE WHEN json_valid(r.content_json) THEN json_extract(r.content_json,'$.title') END title",
  available: 'a.deleted_at IS NULL',
  joins: `LEFT JOIN ${revisions} r ON r.id=a.current_revision_id`,
});

/** Availability and page details share the same source identity and eligibility rules. */
const sourceQueries: Record<string, SourceQuery> = {
  ALBUM: namedSource(
    'albums',
    `title,CASE WHEN intent='${MATERIAL_LIBRARY_ALBUM_INTENT}' THEN 'MATERIAL_ALBUM' ELSE 'CREATION_ALBUM' END display_type,
    CASE WHEN intent='${MATERIAL_LIBRARY_ALBUM_INTENT}' THEN 'MATERIAL_ALBUM' ELSE 'ALBUM' END navigate_type,id navigate_id`,
  ),
  PROMPT_SERIES: namedSource('prompt_series'),
  CREATION: namedSource('creations'),
  CREATION_DRAFT: namedSource('creation_drafts'),
  DOCUMENT: namedSource('documents'),
  IMAGE_BREAKDOWN: namedSource('image_breakdowns'),
  GIF_DOCUMENT: namedSource('gif_documents'),
  ARTICLE: revisionSource('articles', 'article_revisions'),
  SOCIAL_POST_DRAFT: revisionSource('social_post_drafts', 'social_post_revisions'),
  EVALUATION_SUITE: revisionSource('evaluation_suites', 'evaluation_suite_revisions'),
  IMAGE_ASSET: {
    from: 'image_assets a',
    key: 'a.id',
    available: 'a.deleted_at IS NULL',
    ctes: `source_forms AS (${creationImageSourceFormsSql('SELECT id FROM requested')})`,
    select: `COALESCE(NULLIF(m.display_name,''),m.original_name) title,
      a.id thumbnail_asset_id,'MATERIAL' navigate_type,t.id navigate_id,
      CASE WHEN a.mime_type LIKE 'video/%' THEN 'VIDEO_ASSET' WHEN a.mime_type LIKE 'audio/%' THEN 'AUDIO_ASSET' ELSE 'IMAGE_ASSET' END display_type,
      'CREATION_ITEM' title_type,f.creation_item_id title_id`,
    joins: `LEFT JOIN materials t ON t.id=(SELECT id FROM materials
      WHERE image_asset_id=a.id AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1)
      LEFT JOIN external_material_metadata m ON m.material_id=t.id
      LEFT JOIN source_forms f ON f.asset_id=a.id`,
  },
  MATERIAL: {
    from: 'materials a',
    key: 'a.id',
    available: `a.deleted_at IS NULL AND (a.image_asset_id IS NULL OR EXISTS(
      SELECT 1 FROM image_assets i WHERE i.id=a.image_asset_id AND i.deleted_at IS NULL))`,
    select: `COALESCE(NULLIF(m.display_name,''),m.original_name) title,
      a.image_asset_id thumbnail_asset_id,'IMAGE_ASSET' title_type,a.image_asset_id title_id`,
    joins: 'LEFT JOIN external_material_metadata m ON m.material_id=a.id',
  },
  TERM: {
    from: 'terms t',
    key: 't.id',
    select: 'r.title',
    joins: 'LEFT JOIN term_revisions r ON r.id=t.current_revision_id',
  },
  TERM_CATEGORY: namedSource('term_categories', 'name title', ''),
  WORD_PALETTE: {
    from: 'word_palettes p',
    key: 'p.id',
    select: 'r.name title',
    available: 'p.deleted_at IS NULL',
    joins: 'LEFT JOIN word_palette_revisions r ON r.id=p.current_revision_id',
  },
  LOCAL_SPACE: namedSource('local_spaces', 'name title', ''),
  PACK: namedSource('packs', 'display_name title', ''),
  PACK_INSTALL_ATTEMPT: {
    from: `pack_install_attempts a JOIN pack_installations i ON i.id=a.installation_id
      JOIN packs p ON p.id=i.pack_id`,
    key: 'a.id',
    select: 'p.display_name title',
  },
  PACK_SYNC_RUN: namedSource(
    'pack_sync_runs',
    'kind sync_kind,status sync_status,items_json sync_items',
    'finished_at IS NOT NULL',
  ),
  PETAL_LAYER: namedSource('desktop_petal_layers', 'name title', ''),
};

/** Never read event payloads; range-wide eligibility checks omit all presentation joins and fields. */
function sourceQuery(source: SourceQuery, details: boolean) {
  return `WITH requested(id) AS (SELECT value FROM json_each(?))
    ${details && source.ctes ? `,${source.ctes}` : ''}
    SELECT ${source.key} source_id${details ? `,${source.select}` : ''}
    FROM ${source.from} ${details ? (source.joins ?? '') : ''}
    WHERE ${source.key} IN (SELECT id FROM requested) ${source.available ? `AND ${source.available}` : ''}`;
}

type SourceRow = {
  source_id: string;
  title?: unknown;
  type?: unknown;
  id?: unknown;
  navigate_type?: unknown;
  navigate_id?: unknown;
  thumbnail_asset_id?: unknown;
  sync_kind?: unknown;
  sync_status?: unknown;
  sync_items?: unknown;
  display_type?: unknown;
  title_type?: unknown;
  title_id?: unknown;
};
type CalendarSource = {
  title: string;
  type: string | null;
  available: boolean;
  navigateTo: CalendarEntityRef | null;
  thumbnailAssetId: string | null;
  packSync: PackSyncSummary | null;
};
const missingSource: CalendarSource = {
  title: '',
  type: null,
  available: false,
  navigateTo: null,
  thumbnailAssetId: null,
  packSync: null,
};
const normalize = (ref: CalendarEntityRef) => ({ type: calendarSourceAliases[ref.type] ?? ref.type, id: ref.id });
const sourceKey = (ref: CalendarEntityRef) => `${ref.type}\u0000${ref.id}`;

export class CalendarSourceReader {
  private readonly statements = new Map<string, Database.Statement>();
  private readonly rows = new Map<string, SourceRow | null>();
  private readonly results = new Map<string, CalendarSource>();
  constructor(
    private readonly db: Database.Database,
    private readonly mode: 'details' | 'availability' = 'details',
  ) {}
  clearResults() {
    this.rows.clear();
    this.results.clear();
  }

  /** Load distinct sources and their available parents in bounded batches. */
  prefetch(refs: CalendarEntityRef[], depth = 0) {
    let pending = new Map(
      refs.map((ref) => {
        const value = normalize(ref);
        return [sourceKey(value), value];
      }),
    );
    for (; pending.size && depth <= 5; depth++) {
      const byType = new Map<string, CalendarEntityRef[]>();
      for (const [key, ref] of pending) {
        if (this.rows.has(key)) continue;
        this.rows.set(key, null);
        const group = byType.get(ref.type) ?? [];
        group.push(ref);
        byType.set(ref.type, group);
      }
      for (const [type, group] of byType) {
        const parentSource = calendarParentSources[type];
        const source = sourceQueries[type];
        const sql = source
          ? sourceQuery(source, this.mode === 'details')
          : parentSource
            ? calendarParentQuery(parentSource, true, true)
            : undefined;
        if (!sql) continue;
        let statement = this.statements.get(type);
        if (!statement) {
          statement = this.db.prepare(sql);
          this.statements.set(type, statement);
        }
        for (let offset = 0; offset < group.length; offset += 400) {
          const rows = statement.all(
            JSON.stringify(group.slice(offset, offset + 400).map((ref) => ref.id)),
          ) as SourceRow[];
          for (const row of rows) {
            const key = sourceKey({ type, id: row.source_id });
            // Ordered parent sources can yield several rows; keep the same first row as a single read.
            if (!this.rows.get(key)) this.rows.set(key, row);
          }
        }
      }
      const next = new Map<string, CalendarEntityRef>();
      for (const [key, ref] of pending) {
        const row = this.rows.get(key);
        const parentType = sourceQueries[ref.type] ? row?.title_type : row?.type;
        const parentId = sourceQueries[ref.type] ? row?.title_id : row?.id;
        if (typeof parentType !== 'string' || typeof parentId !== 'string') continue;
        const target = normalize({ type: parentType, id: parentId });
        next.set(sourceKey(target), target);
      }
      pending = next;
    }
  }

  read(ref: CalendarEntityRef, depth = 0): CalendarSource {
    const { type } = normalize(ref);
    const key = sourceKey({ type, id: ref.id });
    const cached = this.results.get(key);
    if (cached) return cached;
    if (depth > 5) {
      const missing = missingSource;
      this.results.set(key, missing);
      return missing;
    }
    if (!this.rows.has(key)) this.prefetch([ref], depth);
    const row = this.rows.get(key);
    if (!row) {
      const missing = missingSource;
      this.results.set(key, missing);
      return missing;
    }
    if (calendarParentSources[type] && !sourceQueries[type]) {
      const result =
        typeof row.type === 'string' && typeof row.id === 'string'
          ? this.read({ type: row.type, id: row.id }, depth + 1)
          : { ...missingSource, available: type === 'CREATION_ITEM' };
      this.results.set(key, result);
      return result;
    }
    if (this.mode === 'availability') {
      const result = { ...missingSource, available: true };
      this.results.set(key, result);
      return result;
    }
    if (type === 'PACK_SYNC_RUN') {
      const result: CalendarSource = {
        ...missingSource,
        available: true,
        packSync: packSyncSummarySchema.parse({
          runId: ref.id,
          kind: row.sync_kind,
          status: row.sync_status,
          packs: JSON.parse(typeof row.sync_items === 'string' ? row.sync_items : '[]'),
        }),
      };
      this.results.set(key, result);
      return result;
    }
    const titleSource =
      typeof row.title_type === 'string' && typeof row.title_id === 'string'
        ? this.read({ type: row.title_type, id: row.title_id }, depth + 1)
        : null;
    const result: CalendarSource = {
      title: titleSource?.title.trim() || (typeof row.title === 'string' ? row.title.slice(0, 300) : ''),
      type: typeof row.display_type === 'string' ? row.display_type : type,
      thumbnailAssetId: typeof row.thumbnail_asset_id === 'string' ? row.thumbnail_asset_id : null,
      packSync: null,
      available: true,
      navigateTo: {
        type:
          typeof row.navigate_id === 'string' && typeof row.navigate_type === 'string'
            ? row.navigate_type
            : type === 'SOCIAL_POST_DRAFT'
              ? 'SOCIAL_POST'
              : type === 'DOCUMENT'
                ? 'VIDEO_DOCUMENT'
                : type,
        id: typeof row.navigate_id === 'string' ? row.navigate_id : ref.id,
      },
    };
    this.results.set(key, result);
    return result;
  }
}

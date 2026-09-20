import type Database from 'better-sqlite3';
import type {
  CalendarUsageCoverageNote,
  CalendarUsageQuery,
  CalendarUsageRun,
  CalendarUsageSource,
  CalendarUsageSourceCoverage,
} from '@/shared/calendar-usage';

export const calendarTokenColumns = {
  knownInputTokens: 'input_tokens',
  knownCachedInputTokens: 'cached_input_tokens',
  knownOutputTokens: 'output_tokens',
  knownReasoningOutputTokens: 'reasoning_output_tokens',
  knownTotalTokens: 'total_tokens',
} as const;
export type CalendarTokenField = keyof typeof calendarTokenColumns;
export const calendarTokenFields = Object.keys(calendarTokenColumns) as CalendarTokenField[];

interface UsageDefinition {
  table: string;
  entityType: string;
  requestedColumn: string | null;
  target: 'PROMPT_VERSION' | 'SCOPE' | 'DOCUMENT' | 'ARTICLE';
  storedTokens: boolean;
  notes: CalendarUsageCoverageNote[];
}

// Fixed internal identifiers only. Read each run exactly once, without joining
// output assets, background jobs, proposal rows or current album membership.
export const calendarUsageDefinitions: Record<CalendarUsageSource, UsageDefinition> = {
  IMAGE_GENERATION: {
    table: 'generation_runs',
    entityType: 'GENERATION_RUN',
    requestedColumn: 'model_key',
    target: 'PROMPT_VERSION',
    storedTokens: false,
    notes: ['TOKENS_NOT_STORED', 'REQUESTED_ROUTE_ONLY', 'MISSING_START_TIME_NOT_INCLUDED'],
  },
  ASSISTANT: {
    table: 'assistant_runs',
    entityType: 'ASSISTANT_RUN',
    requestedColumn: 'model_key',
    target: 'SCOPE',
    storedTokens: false,
    notes: ['TOKENS_NOT_STORED', 'REQUESTED_ROUTE_ONLY'],
  },
  AGENT_CHAT: {
    table: 'ai_processes',
    entityType: 'AI_PROCESS',
    requestedColumn: null,
    target: 'SCOPE',
    storedTokens: false,
    // Thread totals lack a known per-run baseline; other observed headers have
    // no reliable cumulative/delta discriminator. Do not infer a consumption.
    notes: ['THREAD_TOTALS_NOT_ATTRIBUTABLE', 'MODEL_NOT_RECORDED'],
  },
  VIDEO_DOCUMENT_GENERATION: {
    table: 'video_document_generation_runs',
    entityType: 'VIDEO_DOCUMENT_GENERATION_RUN',
    requestedColumn: 'requested_model',
    target: 'DOCUMENT',
    storedTokens: true,
    // The current Codex text adapter writes input.model into actual_model.
    // A field name is not independent evidence of the model that executed.
    notes: ['MULTI_STAGE_SUBTOTAL', 'MODEL_OBSERVATION_UNVERIFIED'],
  },
  VIDEO_TRANSLATION: {
    table: 'video_document_translation_runs',
    entityType: 'VIDEO_DOCUMENT_TRANSLATION_RUN',
    requestedColumn: 'requested_model',
    target: 'DOCUMENT',
    storedTokens: true,
    notes: ['MULTI_STAGE_SUBTOTAL', 'MODEL_OBSERVATION_UNVERIFIED'],
  },
  LOCAL_TRANSCRIPTION: {
    table: 'video_document_transcription_runs',
    entityType: 'VIDEO_DOCUMENT_TRANSCRIPTION_RUN',
    requestedColumn: 'model_id',
    target: 'DOCUMENT',
    storedTokens: false,
    notes: ['TOKENS_NOT_STORED', 'LOCAL_COMPUTE_ONLY'],
  },
  ARTICLE_CHECK: {
    table: 'article_check_runs',
    entityType: 'ARTICLE_CHECK_RUN',
    requestedColumn: 'requested_model',
    target: 'ARTICLE',
    storedTokens: false,
    notes: ['TOKENS_NOT_STORED', 'REQUESTED_ROUTE_ONLY'],
  },
};

export interface CalendarUsageRow extends Record<CalendarTokenField, unknown> {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  requestedModel: string | null;
  observedModel: string | null;
  usageAvailability: string | null;
  targetType: string | null;
  targetId: string | null;
}
export interface CalendarUsageSourceRead {
  source: CalendarUsageSource;
  table: string;
  entityType: string;
  targetBasis: CalendarUsageRun['targetBasis'];
  requestedModel: string;
  targetType: string;
  targetId: string;
  columns: Set<string>;
  coverage: CalendarUsageSourceCoverage;
  notes: Set<CalendarUsageCoverageNote>;
}
export interface CalendarUsagePosition {
  at: string;
  source: CalendarUsageSource;
  id: string;
}

export function calendarUsageTables(db: Database.Database) {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
}
function tableColumns(db: Database.Database, tables: Set<string>, table: string) {
  return new Set(
    tables.has(table)
      ? (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)
      : [],
  );
}
const trimmed = (expression: string) => `NULLIF(trim(${expression}), '')`;

export function prepareCalendarUsageSource(
  db: Database.Database,
  tables: Set<string>,
  source: CalendarUsageSource,
): CalendarUsageSourceRead {
  const definition = calendarUsageDefinitions[source];
  const columns = tableColumns(db, tables, definition.table);
  const notes = new Set(definition.notes);
  const exists = tables.has(definition.table);
  const available = exists && ['id', 'started_at', 'status'].every((column) => columns.has(column));
  if (!exists) notes.add('SOURCE_TABLE_MISSING');
  else if (!available) notes.add('SOURCE_COLUMNS_MISSING');
  const read: CalendarUsageSourceRead = {
    source,
    table: definition.table,
    entityType: definition.entityType,
    targetBasis: 'UNASSIGNED',
    requestedModel: 'NULL',
    targetType: 'NULL',
    targetId: 'NULL',
    columns,
    coverage: { source, available, includedRunCount: 0, truncated: false, notes: [] },
    notes,
  };
  if (!available) return read;
  if (definition.requestedColumn) {
    if (columns.has(definition.requestedColumn)) read.requestedModel = trimmed(`run.${definition.requestedColumn}`);
    else notes.add('SOURCE_COLUMNS_MISSING');
  }
  if (definition.storedTokens && !Object.values(calendarTokenColumns).every((column) => columns.has(column)))
    notes.add('SOURCE_COLUMNS_MISSING');
  if (definition.target === 'PROMPT_VERSION' && columns.has('prompt_version_id')) {
    const versionColumns = tableColumns(db, tables, 'prompt_versions');
    if (versionColumns.has('id') && versionColumns.has('series_id')) {
      read.targetType = "'PROMPT_SERIES'";
      read.targetId = trimmed(
        '(SELECT scope.series_id FROM prompt_versions scope WHERE scope.id=run.prompt_version_id)',
      );
      read.targetBasis = 'PROMPT_VERSION_SCOPE';
    }
  } else if (definition.target === 'SCOPE' && columns.has('scope_kind') && columns.has('scope_id')) {
    read.targetType = "CASE run.scope_kind WHEN 'SERIES' THEN 'PROMPT_SERIES' WHEN 'DRAFT' THEN 'CREATION_DRAFT' END";
    read.targetId = trimmed("CASE WHEN run.scope_kind IN ('DRAFT','SERIES') THEN run.scope_id END");
    read.targetBasis = 'RUN_SCOPE';
  } else {
    const column =
      definition.target === 'DOCUMENT' ? 'document_id' : definition.target === 'ARTICLE' ? 'article_id' : null;
    if (column && columns.has(column)) {
      read.targetType = definition.target === 'DOCUMENT' ? "'DOCUMENT'" : "'ARTICLE'";
      read.targetId = trimmed(`run.${column}`);
      read.targetBasis = 'RUN_SCOPE';
    }
  }
  if (read.targetBasis === 'UNASSIGNED') notes.add('TARGET_NOT_RECORDED');
  return read;
}

/** Index and UTC predicates first; convert only selected records into local dates. */
export function calendarUsageRows(
  db: Database.Database,
  read: CalendarUsageSourceRead,
  query: CalendarUsageQuery,
  from: string,
  to: string,
  position?: CalendarUsagePosition | null,
  limit?: number,
) {
  const definition = calendarUsageDefinitions[read.source];
  const predicates = ['run.started_at >= ?', 'run.started_at < ?'];
  const args: (string | number)[] = [from, to];
  const model = query.modelAttribution === 'OBSERVED' ? 'NULL' : read.requestedModel;
  if (query.model !== undefined) {
    predicates.push(query.model === null ? `${model} IS NULL` : `${model} = ?`);
    if (query.model !== null) args.push(query.model);
  }
  if (query.target !== undefined) {
    if (query.target === null) predicates.push(`(${read.targetType} IS NULL OR ${read.targetId} IS NULL)`);
    else {
      predicates.push(`(${read.targetType}) = ? AND (${read.targetId}) = ?`);
      args.push(query.target.type, query.target.id);
    }
  }
  if (position) {
    // Sources sort by their fixed string identity, not caller filter ordering.
    predicates.push('(run.started_at > ? OR (run.started_at = ? AND (? > ? OR (? = ? AND run.id > ?))))');
    args.push(position.at, position.at, read.source, position.source, read.source, position.source, position.id);
  }
  const tokens = calendarTokenFields
    .map((field) => {
      const column = calendarTokenColumns[field];
      return `${definition.storedTokens && read.columns.has(column) ? `run.${column}` : 'NULL'} AS ${field}`;
    })
    .join(', ');
  if (limit !== undefined) args.push(limit);
  return db
    .prepare(
      `SELECT run.id,run.started_at AS startedAt,run.status,
    ${read.columns.has('finished_at') ? 'run.finished_at' : 'NULL'} AS finishedAt,
    ${read.requestedModel} AS requestedModel,NULL AS observedModel,
    ${definition.storedTokens && read.columns.has('usage_availability') ? 'run.usage_availability' : 'NULL'} AS usageAvailability,
    (${read.targetType}) AS targetType,(${read.targetId}) AS targetId,${tokens}
    FROM ${read.table} run WHERE ${predicates.join(' AND ')}
    ORDER BY run.started_at COLLATE BINARY,run.id COLLATE BINARY${limit === undefined ? '' : ' LIMIT ?'}`,
    )
    .iterate(...args) as IterableIterator<CalendarUsageRow>;
}

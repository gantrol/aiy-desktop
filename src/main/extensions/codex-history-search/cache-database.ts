import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import codexHistorySearchCacheRevision1Sql from '@/main/database/sql/v03-codex-history-search-cache-revision-001.sql?raw';
import codexHistorySearchCacheRevision1ProjectMetadataSql from '@/main/database/sql/v03-codex-history-search-cache-revision-001-project-metadata.sql?raw';
import codexHistorySearchCacheRevision2IncrementalSql from '@/main/database/sql/v03-codex-history-search-cache-revision-002-incremental.sql?raw';
import codexHistorySearchCacheRevision3OrganizationSql from '@/main/database/sql/v03-codex-history-search-cache-revision-003-organization.sql?raw';
import codexHistorySearchCacheRevision4SourceSemanticsSql from '@/main/database/sql/v03-codex-history-search-cache-revision-004-source-semantics.sql?raw';
import { CodexHistoryUserTaskSources } from '@/main/extensions/codex-history-search/user-task-sources';
import type {
  CodexHistoryFilterOptionsInput,
  CodexHistoryIndexState,
  CodexHistoryMatchRole,
  CodexHistorySearchInput,
  CodexHistorySearchPage,
  CodexHistorySearchResult,
  CodexHistoryThreadSource,
} from '@/shared/contracts/codex-history-search';
import type {
  CodexHistorySourceSnapshot,
  CodexHistorySourceThread,
} from '@/main/extensions/codex-history-search/source-reader';
import { readCodexHistoryFilterOptions } from '@/main/extensions/codex-history-search/cache-navigation';

const DATABASE_SCHEMA_VERSION = 4;
const MAX_CACHED_THREADS = 100_000;
const CACHED_THREAD_LOOKUP_BATCH_SIZE = 500;
const MAX_SEARCH_CANDIDATES = 5_000;
const MAX_INDEXED_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;
const SNIPPET_CONTEXT_CHARACTERS = 120;

const indexMetaRowSchema = z
  .object({
    sourceSignature: z.string().length(64).nullable(),
    sourceHistoryId: z.string().length(64).nullable(),
    sourceHistoryRowId: z.number().int().nonnegative().safe(),
    sourceStateId: z.string().length(64).nullable(),
    sourceThreadUpdatedAtMs: z.number().int().nonnegative().safe(),
    sourceThreadCount: z.number().int().nonnegative().safe(),
    sourceProjectSignature: z.string().length(64).nullable(),
    indexedAt: z.string().datetime({ offset: true }).nullable(),
    indexedThreads: z.number().int().nonnegative().safe(),
    indexedMessages: z.number().int().nonnegative().safe(),
  })
  .strict();
const countRowSchema = z.object({ count: z.number().int().nonnegative().safe() }).strict();
const sqliteTableInfoRowSchema = z.object({ name: z.string() }).passthrough();
const cachedThreadRowSchema = z
  .object({
    rowId: z.number().int().positive().safe(),
    threadId: z.string().min(1).max(512),
    title: z.string().min(1).max(500),
    titleAvailable: z.number().int().min(0).max(1),
    projectId: z.string().max(512),
    projectName: z.string().max(500),
    sectionId: z.string().max(512),
    sectionName: z.string().max(500),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    pinned: z.number().int().min(0).max(1),
    workspace: z.string().max(32_768),
    branch: z.string().max(1_024),
    archived: z.number().int().min(0).max(1),
    source: z.enum(['USER', 'SUBAGENT', 'OTHER']),
    createdAtMs: z.number().int().nonnegative().safe(),
    updatedAtMs: z.number().int().nonnegative().safe(),
    preview: z.string().max(256 * 1024),
    metadataText: z.string().max(256 * 1024),
  })
  .strict();
const candidateThreadRowSchema = z
  .object({
    threadId: z.string().min(1).max(512),
    title: z.string().min(1).max(500),
    titleAvailable: z.number().int().min(0).max(1),
    projectId: z.string().max(512),
    projectName: z.string().max(500),
    sectionId: z.string().max(512),
    sectionName: z.string().max(500),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    pinned: z.number().int().min(0).max(1),
    workspace: z.string().max(32_768),
    branch: z.string().max(1_024),
    archived: z.number().int().min(0).max(1),
    source: z.enum(['USER', 'SUBAGENT', 'OTHER']),
    createdAtMs: z.number().int().nonnegative().safe(),
    updatedAtMs: z.number().int().nonnegative().safe(),
    preview: z.string().max(256 * 1024),
    matchText: z.string().max(MAX_INDEXED_MESSAGE_TEXT_CHARACTERS),
    rank: z.number().finite(),
  })
  .strict();
const candidateMessageRowSchema = candidateThreadRowSchema
  .omit({ preview: true })
  .extend({
    role: z.enum(['USER', 'ASSISTANT']),
  })
  .strict();

interface SearchCandidate {
  threadId: string;
  title: string;
  titleAvailable: boolean;
  projectId: string;
  projectName: string;
  sectionId: string;
  sectionName: string;
  sectionPosition: number | null;
  pinned: boolean;
  workspace: string;
  branch: string;
  archived: boolean;
  source: CodexHistoryThreadSource;
  createdAtMs: number;
  updatedAtMs: number;
  role: CodexHistoryMatchRole;
  text: string;
  rank: number;
  matchCount: number;
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function ftsPhrase(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function localDateStart(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year!, month! - 1, day!).getTime();
}

function searchBounds(input: CodexHistorySearchInput) {
  const fromMs = input.from ? localDateStart(input.from) : null;
  if (!input.to) return { fromMs, toExclusiveMs: null };
  const toExclusive = new Date(localDateStart(input.to));
  toExclusive.setDate(toExclusive.getDate() + 1);
  return { fromMs, toExclusiveMs: toExclusive.getTime() };
}

function threadFilters(input: CodexHistorySearchInput, alias = 't') {
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  clauses.push(
    input.includeSubagents ? `${alias}.thread_source IN ('USER', 'SUBAGENT')` : `${alias}.thread_source = 'USER'`,
  );
  if (input.archive === 'ACTIVE') clauses.push(`${alias}.archived = 0`);
  if (input.archive === 'ARCHIVED') clauses.push(`${alias}.archived = 1`);
  if (input.projectId) {
    clauses.push(`${alias}.project_id = ?`);
    parameters.push(input.projectId);
  }
  if (input.sectionId) {
    clauses.push(
      `(${alias}.section_id = ? OR ${alias}.project_id IN (
         SELECT p.project_id FROM codex_history_projects AS p WHERE p.section_id = ?
       ))`,
    );
    parameters.push(input.sectionId, input.sectionId);
  }
  if (input.threadId) {
    clauses.push(`${alias}.thread_id = ?`);
    parameters.push(input.threadId);
  }
  if (input.workspace) {
    clauses.push(`instr(lower(${alias}.workspace), ?) > 0`);
    parameters.push(input.workspace.toLocaleLowerCase());
  }
  if (input.branch) {
    clauses.push(`instr(lower(${alias}.branch), ?) > 0`);
    parameters.push(input.branch.toLocaleLowerCase());
  }
  const { fromMs, toExclusiveMs } = searchBounds(input);
  if (fromMs !== null) {
    clauses.push(`${alias}.updated_at_ms >= ?`);
    parameters.push(fromMs);
  }
  if (toExclusiveMs !== null) {
    clauses.push(`${alias}.updated_at_ms < ?`);
    parameters.push(toExclusiveMs);
  }
  return { clauses, parameters };
}

function isoTimestamp(epochMs: number) {
  return new Date(epochMs).toISOString();
}

function compactSnippet(text: string, query: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (!query) return compact.slice(0, SNIPPET_CONTEXT_CHARACTERS * 2);
  const normalized = normalizeSearchText(compact);
  const matchIndex = normalized.indexOf(query);
  if (matchIndex < 0) return compact.slice(0, SNIPPET_CONTEXT_CHARACTERS * 2);
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARACTERS);
  const end = Math.min(compact.length, matchIndex + query.length + SNIPPET_CONTEXT_CHARACTERS);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function searchResult(candidate: SearchCandidate, query: string): CodexHistorySearchResult {
  return {
    threadId: candidate.threadId,
    title: candidate.title,
    titleAvailable: candidate.titleAvailable,
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    sectionId: candidate.sectionId,
    sectionName: candidate.sectionName,
    sectionPosition: candidate.sectionPosition,
    pinned: candidate.pinned,
    workspace: candidate.workspace,
    branch: candidate.branch,
    archived: candidate.archived,
    source: candidate.source,
    createdAt: isoTimestamp(candidate.createdAtMs),
    updatedAt: isoTimestamp(candidate.updatedAtMs),
    role: candidate.role,
    snippet: compactSnippet(candidate.text, query).slice(0, 1_200),
    matchCount: candidate.matchCount,
  };
}

function cachedThreadMatches(row: z.infer<typeof cachedThreadRowSchema>, thread: CodexHistorySourceThread) {
  return (
    row.title === thread.title &&
    row.titleAvailable === (thread.titleAvailable ? 1 : 0) &&
    row.projectId === thread.projectId &&
    row.projectName === thread.projectName &&
    row.sectionId === thread.sectionId &&
    row.sectionName === thread.sectionName &&
    row.sectionPosition === thread.sectionPosition &&
    row.pinned === (thread.pinned ? 1 : 0) &&
    row.workspace === thread.workspace &&
    row.branch === thread.branch &&
    row.archived === (thread.archived ? 1 : 0) &&
    row.source === thread.source &&
    row.createdAtMs === thread.createdAtMs &&
    row.updatedAtMs === thread.updatedAtMs &&
    row.preview === thread.preview &&
    row.metadataText === thread.metadataText
  );
}

function safeRowId(value: number | bigint) {
  const rowId = Number(value);
  if (!Number.isSafeInteger(rowId) || rowId <= 0) throw new Error('Codex history cache generated an invalid row id');
  return rowId;
}

function readCachedThreads(database: Database.Database, threadIds: readonly string[] | null) {
  const select = `SELECT
     row_id AS rowId, thread_id AS threadId, title, title_available AS titleAvailable,
     project_id AS projectId, project_name AS projectName,
     section_id AS sectionId, section_name AS sectionName, section_position AS sectionPosition, pinned,
     workspace, branch, archived,
     thread_source AS source, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs,
     preview, metadata_text AS metadataText
   FROM codex_history_threads`;
  if (threadIds === null) {
    return z.array(cachedThreadRowSchema).max(MAX_CACHED_THREADS).parse(database.prepare(select).all());
  }
  const rows: unknown[] = [];
  for (let offset = 0; offset < threadIds.length; offset += CACHED_THREAD_LOOKUP_BATCH_SIZE) {
    const batch = threadIds.slice(offset, offset + CACHED_THREAD_LOOKUP_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    rows.push(...database.prepare(`${select} WHERE thread_id IN (${placeholders})`).all(...batch));
  }
  return z.array(cachedThreadRowSchema).max(MAX_CACHED_THREADS).parse(rows);
}

export class CodexHistoryThreadSnapshotRequiredError extends Error {
  constructor() {
    super('Codex task metadata changed outside the incremental cursor');
    this.name = 'CodexHistoryThreadSnapshotRequiredError';
  }
}

export class CodexHistorySearchCacheDatabase {
  readonly userTasks: CodexHistoryUserTaskSources;
  private constructor(private readonly database: Database.Database) {
    this.userTasks = new CodexHistoryUserTaskSources(database);
  }

  static async create(directory: string) {
    const root = path.resolve(directory);
    await mkdir(root, { recursive: true });
    const database = new Database(path.join(root, 'history-search.sqlite'), { timeout: 5_000 });
    const cache = new CodexHistorySearchCacheDatabase(database);
    cache.configure();
    cache.migrate();
    return cache;
  }

  meta() {
    return indexMetaRowSchema.parse(
      this.database
        .prepare(
          `SELECT
             source_signature AS sourceSignature,
             source_history_id AS sourceHistoryId,
             source_history_row_id AS sourceHistoryRowId,
             source_state_id AS sourceStateId,
             source_thread_updated_at_ms AS sourceThreadUpdatedAtMs,
             source_thread_count AS sourceThreadCount,
             source_project_signature AS sourceProjectSignature,
             indexed_at AS indexedAt,
             indexed_threads AS indexedThreads,
             indexed_messages AS indexedMessages
           FROM codex_history_index_meta
           WHERE id = 1`,
        )
        .get(),
    );
  }

  apply(snapshot: CodexHistorySourceSnapshot, rebuildMessages: boolean) {
    const cachedThreads = readCachedThreads(
      this.database,
      snapshot.fullThreadSnapshot ? null : snapshot.threads.map(({ threadId }) => threadId),
    );
    if (!snapshot.fullThreadSnapshot) {
      const cachedThreadIds = new Set(cachedThreads.map(({ threadId }) => threadId));
      const addedThreads = snapshot.threads.filter(({ threadId }) => !cachedThreadIds.has(threadId)).length;
      const currentThreads = countRowSchema.parse(
        this.database.prepare('SELECT COUNT(*) AS count FROM codex_history_threads').get(),
      ).count;
      if (currentThreads + addedThreads !== snapshot.sourceThreadCount) {
        throw new CodexHistoryThreadSnapshotRequiredError();
      }
    }
    const insertThread = this.database.prepare(
      `INSERT INTO codex_history_threads (
         thread_id, title, title_available, project_id, project_name,
         section_id, section_name, section_position, pinned,
         workspace, branch, archived, thread_source, created_at_ms, updated_at_ms, preview, metadata_text, search_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateThread = this.database.prepare(
      `UPDATE codex_history_threads
       SET title = ?, title_available = ?, project_id = ?, project_name = ?,
           section_id = ?, section_name = ?, section_position = ?, pinned = ?,
           workspace = ?, branch = ?, archived = ?, thread_source = ?, created_at_ms = ?, updated_at_ms = ?,
           preview = ?, metadata_text = ?, search_text = ?
       WHERE row_id = ?`,
    );
    const insertProject = this.database.prepare(
      `INSERT INTO codex_history_projects (
         project_id, name, workspace, position, section_id, section_position
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertSection = this.database.prepare(
      `INSERT INTO codex_history_sections (section_id, name, position) VALUES (?, ?, ?)`,
    );
    const insertThreadFts = this.database.prepare(
      'INSERT INTO codex_history_thread_fts (rowid, metadata_text) VALUES (?, ?)',
    );
    const deleteThreadFts = this.database.prepare('DELETE FROM codex_history_thread_fts WHERE rowid = ?');
    const deleteMessageFtsForThread = this.database.prepare(
      `DELETE FROM codex_history_message_fts
       WHERE rowid IN (SELECT row_id FROM codex_history_messages WHERE thread_id = ?)`,
    );
    const deleteThread = this.database.prepare('DELETE FROM codex_history_threads WHERE row_id = ?');
    const insertMessage = this.database.prepare(
      `INSERT INTO codex_history_messages (
         source_row_id, thread_id, role, created_at_ms, text, search_text
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_row_id) DO NOTHING`,
    );
    const insertMessageFts = this.database.prepare('INSERT INTO codex_history_message_fts (rowid, text) VALUES (?, ?)');
    const indexedAt = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM codex_history_projects').run();
      for (const project of snapshot.projects) {
        insertProject.run(
          project.projectId,
          project.name,
          project.workspace,
          project.position,
          project.sectionId,
          project.sectionPosition,
        );
      }
      this.database.prepare('DELETE FROM codex_history_sections').run();
      for (const section of snapshot.sections) {
        insertSection.run(section.sectionId, section.name, section.position);
      }
      if (rebuildMessages) {
        this.database.prepare('DELETE FROM codex_history_message_fts').run();
        this.database.prepare('DELETE FROM codex_history_messages').run();
      }
      const removedThreads = new Map(cachedThreads.map((thread) => [thread.threadId, thread]));
      for (const thread of snapshot.threads) {
        const cached = removedThreads.get(thread.threadId);
        removedThreads.delete(thread.threadId);
        if (cached && cachedThreadMatches(cached, thread)) continue;
        const searchText = normalizeSearchText(thread.metadataText);
        const values = [
          thread.title,
          thread.titleAvailable ? 1 : 0,
          thread.projectId,
          thread.projectName,
          thread.sectionId,
          thread.sectionName,
          thread.sectionPosition,
          thread.pinned ? 1 : 0,
          thread.workspace,
          thread.branch,
          thread.archived ? 1 : 0,
          thread.source,
          thread.createdAtMs,
          thread.updatedAtMs,
          thread.preview,
          thread.metadataText,
          searchText,
        ] as const;
        const rowId = cached
          ? (updateThread.run(...values, cached.rowId), cached.rowId)
          : safeRowId(insertThread.run(thread.threadId, ...values).lastInsertRowid);
        if (cached) deleteThreadFts.run(rowId);
        insertThreadFts.run(rowId, searchText);
      }
      if (snapshot.fullThreadSnapshot) {
        for (const thread of removedThreads.values()) {
          deleteMessageFtsForThread.run(thread.threadId);
          deleteThreadFts.run(thread.rowId);
          deleteThread.run(thread.rowId);
        }
      }
      for (const message of snapshot.messages) {
        const searchText = normalizeSearchText(message.text);
        const result = insertMessage.run(
          message.sourceRowId,
          message.threadId,
          message.role,
          message.createdAtMs,
          message.text,
          searchText,
        );
        if (result.changes) insertMessageFts.run(safeRowId(result.lastInsertRowid), searchText);
      }
      this.userTasks.apply();
      const indexedThreads = countRowSchema.parse(
        this.database.prepare('SELECT COUNT(*) AS count FROM codex_history_threads').get(),
      ).count;
      const indexedMessages = countRowSchema.parse(
        this.database.prepare('SELECT COUNT(*) AS count FROM codex_history_messages').get(),
      ).count;
      this.database
        .prepare(
          `UPDATE codex_history_index_meta
           SET source_signature = ?, source_history_id = ?, source_history_row_id = ?, source_state_id = ?,
               source_thread_updated_at_ms = ?, source_thread_count = ?, source_project_signature = ?,
               indexed_at = ?, indexed_threads = ?, indexed_messages = ?
           WHERE id = 1`,
        )
        .run(
          snapshot.paths.signature,
          snapshot.paths.historySourceId,
          snapshot.scannedThroughRowId,
          snapshot.paths.stateSourceId,
          snapshot.sourceThreadUpdatedAtMs,
          snapshot.sourceThreadCount,
          snapshot.sourceProjectSignature,
          indexedAt,
          indexedThreads,
          indexedMessages,
        );
    })();
    return this.meta();
  }

  purge() {
    this.database.pragma('secure_delete = ON');
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM codex_history_message_fts').run();
      this.database.prepare('DELETE FROM codex_history_messages').run();
      this.database.prepare('DELETE FROM codex_history_thread_fts').run();
      this.database.prepare('DELETE FROM codex_history_threads').run();
      this.database.prepare('DELETE FROM codex_history_projects').run();
      this.database.prepare('DELETE FROM codex_history_sections').run();
      this.userTasks.clear();
      this.database
        .prepare(
          `UPDATE codex_history_index_meta
           SET source_signature = NULL, source_history_id = NULL, source_history_row_id = 0,
               source_state_id = NULL, source_thread_updated_at_ms = 0, source_thread_count = 0,
               source_project_signature = NULL, indexed_at = NULL, indexed_threads = 0, indexed_messages = 0
           WHERE id = 1`,
        )
        .run();
    })();
    this.database.pragma('wal_checkpoint(TRUNCATE)');
    this.database.exec('VACUUM');
    this.database.pragma('wal_checkpoint(TRUNCATE)');
  }

  filterOptions(input: CodexHistoryFilterOptionsInput) {
    return readCodexHistoryFilterOptions(this.database, input);
  }

  search(input: CodexHistorySearchInput, index: CodexHistoryIndexState): CodexHistorySearchPage {
    const query = normalizeSearchText(input.query);
    if (!query) return this.recent(input, index);
    const filters = threadFilters(input);
    const useFts = Array.from(query).length >= 3;
    const threadWhere = [...filters.clauses];
    const threadParameters: Array<string | number> = [];
    if (useFts) threadParameters.push(ftsPhrase(query));
    else {
      threadWhere.unshift('instr(t.search_text, ?) > 0');
      threadParameters.push(query);
    }
    threadParameters.push(...filters.parameters, MAX_SEARCH_CANDIDATES + 1);
    // A relational tie-breaker here makes FTS materialize and sort every hit. Keep the SQL order rank-only so
    // LIMIT can short-circuit; the bounded candidate merge below applies updated-at and title tie-breakers.
    const threadSql = useFts
      ? `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.section_id AS sectionId, t.section_name AS sectionName,
           t.section_position AS sectionPosition, t.pinned,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           t.preview, t.metadata_text AS matchText,
           codex_history_thread_fts.rank AS rank
         FROM codex_history_thread_fts
         JOIN codex_history_threads AS t ON t.row_id = codex_history_thread_fts.rowid
         WHERE codex_history_thread_fts MATCH ? AND ${filters.clauses.join(' AND ')}
         ORDER BY codex_history_thread_fts.rank ASC
         LIMIT ?`
      : `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.section_id AS sectionId, t.section_name AS sectionName,
           t.section_position AS sectionPosition, t.pinned,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           t.preview, t.metadata_text AS matchText, 0 AS rank
         FROM codex_history_threads AS t
         WHERE ${threadWhere.join(' AND ')}
         ORDER BY t.updated_at_ms DESC
         LIMIT ?`;
    const threadRows =
      input.role === 'ALL'
        ? z
            .array(candidateThreadRowSchema)
            .max(MAX_SEARCH_CANDIDATES + 1)
            .parse(this.database.prepare(threadSql).all(...threadParameters))
        : [];

    const messageWhere = [...filters.clauses];
    const messageParameters: Array<string | number> = [];
    if (useFts) messageParameters.push(ftsPhrase(query));
    else {
      messageWhere.unshift('instr(m.search_text, ?) > 0');
      messageParameters.push(query);
    }
    messageParameters.push(...filters.parameters);
    if (input.role !== 'ALL') {
      messageWhere.push('m.role = ?');
      messageParameters.push(input.role);
    }
    messageParameters.push(MAX_SEARCH_CANDIDATES + 1);
    const messageSql = useFts
      ? `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.section_id AS sectionId, t.section_name AS sectionName,
           t.section_position AS sectionPosition, t.pinned,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           m.role, m.text AS matchText, codex_history_message_fts.rank AS rank
         FROM codex_history_message_fts
         JOIN codex_history_messages AS m ON m.row_id = codex_history_message_fts.rowid
         JOIN codex_history_threads AS t ON t.thread_id = m.thread_id
         WHERE codex_history_message_fts MATCH ? AND ${messageWhere.slice(0).join(' AND ')}
         ORDER BY codex_history_message_fts.rank ASC
         LIMIT ?`
      : `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.section_id AS sectionId, t.section_name AS sectionName,
           t.section_position AS sectionPosition, t.pinned,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           m.role, m.text AS matchText, 1 AS rank
         FROM codex_history_messages AS m
         JOIN codex_history_threads AS t ON t.thread_id = m.thread_id
         WHERE ${messageWhere.join(' AND ')}
         ORDER BY t.updated_at_ms DESC, m.created_at_ms DESC
         LIMIT ?`;
    const messageRows = z
      .array(candidateMessageRowSchema)
      .max(MAX_SEARCH_CANDIDATES + 1)
      .parse(this.database.prepare(messageSql).all(...messageParameters));
    const truncated = threadRows.length > MAX_SEARCH_CANDIDATES || messageRows.length > MAX_SEARCH_CANDIDATES;
    const candidates = new Map<string, SearchCandidate>();
    for (const row of threadRows.slice(0, MAX_SEARCH_CANDIDATES)) {
      if (!normalizeSearchText(row.matchText).includes(query)) continue;
      candidates.set(row.threadId, {
        threadId: row.threadId,
        title: row.title,
        titleAvailable: row.titleAvailable === 1,
        projectId: row.projectId,
        projectName: row.projectName,
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        sectionPosition: row.sectionPosition,
        pinned: row.pinned === 1,
        workspace: row.workspace,
        branch: row.branch,
        archived: row.archived === 1,
        source: row.source,
        createdAtMs: row.createdAtMs,
        updatedAtMs: row.updatedAtMs,
        role: 'THREAD',
        text: normalizeSearchText(row.title).includes(query) ? row.title : row.matchText,
        rank: row.rank,
        matchCount: 1,
      });
    }
    for (const row of messageRows.slice(0, MAX_SEARCH_CANDIDATES)) {
      if (!normalizeSearchText(row.matchText).includes(query)) continue;
      const previous = candidates.get(row.threadId);
      const rank = row.rank + (row.role === 'USER' ? 0.2 : 0.4);
      const next: SearchCandidate = {
        threadId: row.threadId,
        title: row.title,
        titleAvailable: row.titleAvailable === 1,
        projectId: row.projectId,
        projectName: row.projectName,
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        sectionPosition: row.sectionPosition,
        pinned: row.pinned === 1,
        workspace: row.workspace,
        branch: row.branch,
        archived: row.archived === 1,
        source: row.source,
        createdAtMs: row.createdAtMs,
        updatedAtMs: row.updatedAtMs,
        role: row.role,
        text: row.matchText,
        rank,
        matchCount: (previous?.matchCount ?? 0) + 1,
      };
      if (!previous || rank < previous.rank) candidates.set(row.threadId, next);
      else previous.matchCount += 1;
    }
    const sorted = [...candidates.values()].sort(
      (left, right) =>
        left.rank - right.rank || right.updatedAtMs - left.updatedAtMs || left.title.localeCompare(right.title),
    );
    return this.page(input, query, sorted, truncated, index);
  }

  close() {
    this.database.close();
  }

  private recent(input: CodexHistorySearchInput, index: CodexHistoryIndexState): CodexHistorySearchPage {
    const filters = threadFilters(input);
    const orderBy = input.sectionId
      ? 't.section_position IS NULL, t.section_position, t.updated_at_ms DESC, t.thread_id'
      : 't.updated_at_ms DESC, t.thread_id';
    const total = countRowSchema.parse(
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM codex_history_threads AS t WHERE ${filters.clauses.join(' AND ')}`)
        .get(...filters.parameters),
    ).count;
    const offset = (input.page - 1) * input.pageSize;
    const rows = z
      .array(candidateThreadRowSchema)
      .max(input.pageSize)
      .parse(
        this.database
          .prepare(
            `SELECT
               t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
               t.project_id AS projectId, t.project_name AS projectName,
               t.section_id AS sectionId, t.section_name AS sectionName,
               t.section_position AS sectionPosition, t.pinned,
               t.workspace, t.branch, t.archived, t.thread_source AS source,
               t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
               t.preview, t.preview AS matchText, 0 AS rank
             FROM codex_history_threads AS t
             WHERE ${filters.clauses.join(' AND ')}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
          )
          .all(...filters.parameters, input.pageSize, offset),
      );
    return {
      query: input.query,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: total ? Math.ceil(total / input.pageSize) : 0,
      total,
      truncated: false,
      items: rows.map((row) =>
        searchResult(
          {
            threadId: row.threadId,
            title: row.title,
            titleAvailable: row.titleAvailable === 1,
            projectId: row.projectId,
            projectName: row.projectName,
            sectionId: row.sectionId,
            sectionName: row.sectionName,
            sectionPosition: row.sectionPosition,
            pinned: row.pinned === 1,
            workspace: row.workspace,
            branch: row.branch,
            archived: row.archived === 1,
            source: row.source,
            createdAtMs: row.createdAtMs,
            updatedAtMs: row.updatedAtMs,
            role: 'THREAD',
            text: row.preview,
            rank: 0,
            matchCount: 1,
          },
          '',
        ),
      ),
      index,
    };
  }

  private page(
    input: CodexHistorySearchInput,
    query: string,
    candidates: readonly SearchCandidate[],
    truncated: boolean,
    index: CodexHistoryIndexState,
  ): CodexHistorySearchPage {
    const offset = (input.page - 1) * input.pageSize;
    return {
      query: input.query,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: candidates.length ? Math.ceil(candidates.length / input.pageSize) : 0,
      total: candidates.length,
      truncated,
      items: candidates.slice(offset, offset + input.pageSize).map((candidate) => searchResult(candidate, query)),
      index,
    };
  }

  private configure() {
    const journalMode = z
      .string()
      .parse(this.database.pragma('journal_mode', { simple: true }))
      .toLowerCase();
    if (journalMode !== 'wal') this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
  }

  private migrate() {
    const version = z
      .number()
      .int()
      .nonnegative()
      .parse(this.database.pragma('user_version', { simple: true }));
    if (version > DATABASE_SCHEMA_VERSION) throw new Error('Codex history cache database is newer than this app');
    const threadColumns = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(codex_history_threads)'));
    const metaColumns = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(codex_history_index_meta)'));
    const projectCatalogColumns = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(codex_history_projects)'));
    const sectionCatalogColumns = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(codex_history_sections)'));
    const hasUserTaskSources = this.userTasks.hasSchema();
    const hasProjectMetadataColumns = ['project_id', 'project_name'].every((name) =>
      threadColumns.some((column) => column.name === name),
    );
    const hasIncrementalMetadataColumns = [
      'source_history_id',
      'source_history_row_id',
      'source_state_id',
      'source_thread_updated_at_ms',
      'source_thread_count',
      'source_project_signature',
    ].every((name) => metaColumns.some((column) => column.name === name));
    const hasOrganizationMetadata = ['section_id', 'section_name', 'section_position', 'pinned'].every((name) =>
      threadColumns.some((column) => column.name === name),
    );
    const hasOrganizationCatalogs =
      ['project_id', 'name', 'workspace', 'position', 'section_id', 'section_position'].every((name) =>
        projectCatalogColumns.some((column) => column.name === name),
      ) &&
      ['section_id', 'name', 'position'].every((name) => sectionCatalogColumns.some((column) => column.name === name));
    if (
      version === DATABASE_SCHEMA_VERSION &&
      hasProjectMetadataColumns &&
      hasIncrementalMetadataColumns &&
      hasOrganizationMetadata &&
      hasOrganizationCatalogs &&
      hasUserTaskSources
    ) {
      return;
    }
    this.database.transaction(() => {
      if (version < 1) this.database.exec(codexHistorySearchCacheRevision1Sql);
      if (!hasProjectMetadataColumns) this.database.exec(codexHistorySearchCacheRevision1ProjectMetadataSql);
      if (!hasIncrementalMetadataColumns) this.database.exec(codexHistorySearchCacheRevision2IncrementalSql);
      if (!hasOrganizationMetadata || !projectCatalogColumns.length || !sectionCatalogColumns.length) {
        this.database.exec(codexHistorySearchCacheRevision3OrganizationSql);
      }
      if (version < 4 || !hasOrganizationCatalogs) {
        this.database.exec(codexHistorySearchCacheRevision4SourceSemanticsSql);
      }
      if (!hasUserTaskSources) this.userTasks.ensureSchema();
      this.database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    })();
  }
}

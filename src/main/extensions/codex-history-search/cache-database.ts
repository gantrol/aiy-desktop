import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import codexHistorySearchCacheRevision1Sql from '@/main/database/sql/v03-codex-history-search-cache-revision-001.sql?raw';
import codexHistorySearchCacheRevision1ProjectMetadataSql from '@/main/database/sql/v03-codex-history-search-cache-revision-001-project-metadata.sql?raw';
import type {
  CodexHistoryFilterOptions,
  CodexHistoryFilterOptionsInput,
  CodexHistoryIndexState,
  CodexHistoryMatchRole,
  CodexHistorySearchInput,
  CodexHistorySearchPage,
  CodexHistorySearchResult,
  CodexHistoryThreadSource,
} from '@/shared/contracts/codex-history-search';
import type { CodexHistorySourceSnapshot } from '@/main/extensions/codex-history-search/source-reader';

const DATABASE_SCHEMA_VERSION = 1;
const UNRELEASED_DATABASE_SCHEMA_VERSIONS = new Set([2]);
const MAX_SEARCH_CANDIDATES = 5_000;
const MAX_FILTER_PROJECTS = 1_000;
const MAX_FILTER_THREADS = 50;
const MAX_INDEXED_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;
const SNIPPET_CONTEXT_CHARACTERS = 120;

const indexMetaRowSchema = z
  .object({
    sourceSignature: z.string().length(64).nullable(),
    indexedAt: z.string().datetime({ offset: true }).nullable(),
    indexedThreads: z.number().int().nonnegative().safe(),
    indexedMessages: z.number().int().nonnegative().safe(),
  })
  .strict();
const countRowSchema = z.object({ count: z.number().int().nonnegative().safe() }).strict();
const sqliteTableInfoRowSchema = z.object({ name: z.string() }).passthrough();
const candidateThreadRowSchema = z
  .object({
    threadId: z.string().min(1).max(512),
    title: z.string().min(1).max(500),
    titleAvailable: z.number().int().min(0).max(1),
    projectId: z.string().max(512),
    projectName: z.string().max(500),
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
const projectOptionRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(500),
    workspace: z.string().max(32_768),
    threadCount: z.number().int().positive().safe(),
  })
  .strict();
const threadOptionRowSchema = z
  .object({
    threadId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(500),
    projectId: z.string().max(512),
    projectName: z.string().max(500),
    workspace: z.string().max(32_768),
    updatedAtMs: z.number().int().nonnegative().safe(),
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

function filterOptionVisibility(input: CodexHistoryFilterOptionsInput, alias = 't') {
  const clauses = [
    input.includeSubagents ? `${alias}.thread_source IN ('USER', 'SUBAGENT')` : `${alias}.thread_source = 'USER'`,
  ];
  if (input.archive === 'ACTIVE') clauses.push(`${alias}.archived = 0`);
  if (input.archive === 'ARCHIVED') clauses.push(`${alias}.archived = 1`);
  return clauses;
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

export class CodexHistorySearchCacheDatabase {
  private constructor(private readonly database: Database.Database) {}

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
             indexed_at AS indexedAt,
             indexed_threads AS indexedThreads,
             indexed_messages AS indexedMessages
           FROM codex_history_index_meta
           WHERE id = 1`,
        )
        .get(),
    );
  }

  replace(snapshot: CodexHistorySourceSnapshot) {
    const insertThread = this.database.prepare(
      `INSERT INTO codex_history_threads (
         row_id, thread_id, title, title_available, project_id, project_name, workspace, branch, archived, thread_source,
         created_at_ms, updated_at_ms, preview, metadata_text, search_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertThreadFts = this.database.prepare(
      'INSERT INTO codex_history_thread_fts (rowid, metadata_text) VALUES (?, ?)',
    );
    const insertMessage = this.database.prepare(
      `INSERT INTO codex_history_messages (
         row_id, source_row_id, thread_id, role, created_at_ms, text, search_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMessageFts = this.database.prepare('INSERT INTO codex_history_message_fts (rowid, text) VALUES (?, ?)');
    const indexedAt = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM codex_history_message_fts').run();
      this.database.prepare('DELETE FROM codex_history_messages').run();
      this.database.prepare('DELETE FROM codex_history_thread_fts').run();
      this.database.prepare('DELETE FROM codex_history_threads').run();
      snapshot.threads.forEach((thread, index) => {
        const rowId = index + 1;
        const searchText = normalizeSearchText(thread.metadataText);
        insertThread.run(
          rowId,
          thread.threadId,
          thread.title,
          thread.titleAvailable ? 1 : 0,
          thread.projectId,
          thread.projectName,
          thread.workspace,
          thread.branch,
          thread.archived ? 1 : 0,
          thread.source,
          thread.createdAtMs,
          thread.updatedAtMs,
          thread.preview,
          thread.metadataText,
          searchText,
        );
        insertThreadFts.run(rowId, searchText);
      });
      snapshot.messages.forEach((message, index) => {
        const rowId = index + 1;
        const searchText = normalizeSearchText(message.text);
        insertMessage.run(
          rowId,
          message.sourceRowId,
          message.threadId,
          message.role,
          message.createdAtMs,
          message.text,
          searchText,
        );
        insertMessageFts.run(rowId, searchText);
      });
      this.database
        .prepare(
          `UPDATE codex_history_index_meta
           SET source_signature = ?, indexed_at = ?, indexed_threads = ?, indexed_messages = ?
           WHERE id = 1`,
        )
        .run(snapshot.paths.signature, indexedAt, snapshot.threads.length, snapshot.messages.length);
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
      this.database
        .prepare(
          `UPDATE codex_history_index_meta
           SET source_signature = NULL, indexed_at = NULL, indexed_threads = 0, indexed_messages = 0
           WHERE id = 1`,
        )
        .run();
    })();
    this.database.pragma('wal_checkpoint(TRUNCATE)');
    this.database.exec('VACUUM');
    this.database.pragma('wal_checkpoint(TRUNCATE)');
  }

  filterOptions(input: CodexHistoryFilterOptionsInput): CodexHistoryFilterOptions {
    const visibility = filterOptionVisibility(input);
    const projectRows = z
      .array(projectOptionRowSchema)
      .max(MAX_FILTER_PROJECTS + 1)
      .parse(
        this.database
          .prepare(
            `SELECT
               t.project_id AS projectId,
               COALESCE(NULLIF(MAX(t.project_name), ''), t.project_id) AS name,
               MAX(t.workspace) AS workspace,
               COUNT(*) AS threadCount
             FROM codex_history_threads AS t
             WHERE ${visibility.join(' AND ')} AND t.project_id <> ''
             GROUP BY t.project_id
             ORDER BY name COLLATE NOCASE, t.project_id
             LIMIT ?`,
          )
          .all(MAX_FILTER_PROJECTS + 1),
      );
    const threadClauses = [...visibility];
    const threadParameters: string[] = [];
    if (input.projectId) {
      threadClauses.push('t.project_id = ?');
      threadParameters.push(input.projectId);
    }
    const query = normalizeSearchText(input.query);
    if (query) {
      threadClauses.push('(instr(t.search_text, ?) > 0 OR instr(lower(t.thread_id), ?) > 0)');
      threadParameters.push(query, query);
    }
    const threadRows = z
      .array(threadOptionRowSchema)
      .max(MAX_FILTER_THREADS + 1)
      .parse(
        this.database
          .prepare(
            `SELECT
               t.thread_id AS threadId,
               t.title,
               t.project_id AS projectId,
               t.project_name AS projectName,
               t.workspace,
               t.updated_at_ms AS updatedAtMs
             FROM codex_history_threads AS t
             WHERE ${threadClauses.join(' AND ')}
             ORDER BY t.updated_at_ms DESC, t.thread_id
             LIMIT ?`,
          )
          .all(...threadParameters, MAX_FILTER_THREADS + 1),
      );
    return {
      projects: projectRows.slice(0, MAX_FILTER_PROJECTS),
      threads: threadRows.slice(0, MAX_FILTER_THREADS).map((thread) => ({
        threadId: thread.threadId,
        title: thread.title,
        projectId: thread.projectId,
        projectName: thread.projectName,
        workspace: thread.workspace,
        updatedAt: isoTimestamp(thread.updatedAtMs),
      })),
      threadsTruncated: threadRows.length > MAX_FILTER_THREADS,
    };
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
    const threadSql = useFts
      ? `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           t.preview, t.metadata_text AS matchText,
           bm25(codex_history_thread_fts) AS rank
         FROM codex_history_thread_fts
         JOIN codex_history_threads AS t ON t.row_id = codex_history_thread_fts.rowid
         WHERE codex_history_thread_fts MATCH ? AND ${filters.clauses.join(' AND ')}
         ORDER BY rank ASC, t.updated_at_ms DESC
         LIMIT ?`
      : `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           t.preview, t.metadata_text AS matchText, 0 AS rank
         FROM codex_history_threads AS t
         WHERE ${threadWhere.join(' AND ')}
         ORDER BY t.updated_at_ms DESC
         LIMIT ?`;
    const threadRows = z
      .array(candidateThreadRowSchema)
      .max(MAX_SEARCH_CANDIDATES + 1)
      .parse(this.database.prepare(threadSql).all(...threadParameters));

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
           t.workspace, t.branch, t.archived, t.thread_source AS source,
           t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
           m.role, m.text AS matchText, bm25(codex_history_message_fts) AS rank
         FROM codex_history_message_fts
         JOIN codex_history_messages AS m ON m.row_id = codex_history_message_fts.rowid
         JOIN codex_history_threads AS t ON t.thread_id = m.thread_id
         WHERE codex_history_message_fts MATCH ? AND ${messageWhere.slice(0).join(' AND ')}
         ORDER BY rank ASC, t.updated_at_ms DESC
         LIMIT ?`
      : `SELECT
           t.thread_id AS threadId, t.title, t.title_available AS titleAvailable,
           t.project_id AS projectId, t.project_name AS projectName,
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
               t.workspace, t.branch, t.archived, t.thread_source AS source,
               t.created_at_ms AS createdAtMs, t.updated_at_ms AS updatedAtMs,
               t.preview, t.preview AS matchText, 0 AS rank
             FROM codex_history_threads AS t
             WHERE ${filters.clauses.join(' AND ')}
             ORDER BY t.updated_at_ms DESC, t.thread_id
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
    if (version > DATABASE_SCHEMA_VERSION && !UNRELEASED_DATABASE_SCHEMA_VERSIONS.has(version)) {
      throw new Error('Codex history cache database is newer than this app');
    }
    const threadColumns = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(codex_history_threads)'));
    const hasProjectMetadataColumns = ['project_id', 'project_name'].every((name) =>
      threadColumns.some((column) => column.name === name),
    );
    if (version === DATABASE_SCHEMA_VERSION && hasProjectMetadataColumns) return;
    this.database.transaction(() => {
      if (version < 1) this.database.exec(codexHistorySearchCacheRevision1Sql);
      if (!hasProjectMetadataColumns) this.database.exec(codexHistorySearchCacheRevision1ProjectMetadataSql);
      this.database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    })();
  }
}

import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  CodexHistoryFilterOptions,
  CodexHistoryFilterOptionsInput,
} from '@/shared/contracts/codex-history-search';

const MAX_FILTER_PROJECTS = 1_000;
const MAX_FILTER_SECTIONS = 100;
const MAX_SECTION_THREADS = 50;
const MAX_RECENT_THREADS = 20;
const MAX_FILTER_THREADS = 50;

const projectOptionRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(500),
    workspace: z.string().max(32_768),
    threadCount: z.number().int().nonnegative().safe(),
  })
  .strict();
const threadOptionRowSchema = z
  .object({
    threadId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(500),
    projectId: z.string().max(512),
    projectName: z.string().max(500),
    sectionId: z.string().max(512),
    sectionName: z.string().max(500),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    archived: z.number().int().min(0).max(1),
    workspace: z.string().max(32_768),
    updatedAtMs: z.number().int().nonnegative().safe(),
  })
  .strict();
const sectionOptionRowSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(500),
    threadCount: z.number().int().nonnegative().safe(),
  })
  .strict();

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
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

function threadOption(thread: z.infer<typeof threadOptionRowSchema>) {
  return {
    threadId: thread.threadId,
    title: thread.title,
    projectId: thread.projectId,
    projectName: thread.projectName,
    sectionId: thread.sectionId,
    sectionName: thread.sectionName,
    sectionPosition: thread.sectionPosition,
    archived: thread.archived === 1,
    workspace: thread.workspace,
    updatedAt: isoTimestamp(thread.updatedAtMs),
  };
}

const threadOptionSelect = `SELECT
  t.thread_id AS threadId,
  t.title,
  t.project_id AS projectId,
  t.project_name AS projectName,
  t.section_id AS sectionId,
  t.section_name AS sectionName,
  t.section_position AS sectionPosition,
  t.archived,
  t.workspace,
  t.updated_at_ms AS updatedAtMs
FROM codex_history_threads AS t`;

export function readCodexHistoryFilterOptions(
  database: Database.Database,
  input: CodexHistoryFilterOptionsInput,
): CodexHistoryFilterOptions {
  const visibility = filterOptionVisibility(input);
  const projectRows = z
    .array(projectOptionRowSchema)
    .max(MAX_FILTER_PROJECTS + 1)
    .parse(
      database
        .prepare(
          `SELECT
             p.project_id AS projectId,
             p.name,
             p.workspace,
             COUNT(t.thread_id) AS threadCount
           FROM codex_history_projects AS p
           LEFT JOIN codex_history_threads AS t
             ON t.project_id = p.project_id AND ${visibility.join(' AND ')}
           GROUP BY p.project_id, p.name, p.workspace, p.position
           ORDER BY p.position, p.name COLLATE NOCASE, p.project_id
           LIMIT ?`,
        )
        .all(MAX_FILTER_PROJECTS + 1),
    );
  const sectionRows = z
    .array(sectionOptionRowSchema)
    .max(MAX_FILTER_SECTIONS + 1)
    .parse(
      database
        .prepare(
          `SELECT
             s.section_id AS sectionId,
             s.name,
             COUNT(t.thread_id) AS threadCount
           FROM codex_history_sections AS s
           LEFT JOIN codex_history_threads AS t
             ON t.section_id = s.section_id AND ${visibility.join(' AND ')}
           GROUP BY s.section_id, s.name, s.position
           ORDER BY s.position, s.name COLLATE NOCASE, s.section_id
           LIMIT ?`,
        )
        .all(MAX_FILTER_SECTIONS + 1),
    );
  const sectionThreadStatement = database.prepare(
    `${threadOptionSelect}
     WHERE ${visibility.join(' AND ')} AND t.section_id = ?
     ORDER BY t.section_position IS NULL, t.section_position, t.updated_at_ms DESC, t.thread_id
     LIMIT ?`,
  );
  const sections = sectionRows.slice(0, MAX_FILTER_SECTIONS).map((section) => {
    const threads = z
      .array(threadOptionRowSchema)
      .max(MAX_SECTION_THREADS + 1)
      .parse(sectionThreadStatement.all(section.sectionId, MAX_SECTION_THREADS + 1));
    return {
      ...section,
      threads: threads.slice(0, MAX_SECTION_THREADS).map(threadOption),
      threadsTruncated: threads.length > MAX_SECTION_THREADS,
    };
  });
  const recentRows = z
    .array(threadOptionRowSchema)
    .max(MAX_RECENT_THREADS)
    .parse(
      database
        .prepare(
          `${threadOptionSelect}
           WHERE t.thread_source = 'USER' AND t.archived = 0 AND t.section_id = ''
           ORDER BY t.updated_at_ms DESC, t.thread_id
           LIMIT ?`,
        )
        .all(MAX_RECENT_THREADS),
    );
  const threadClauses = [...visibility];
  const threadParameters: string[] = [];
  if (input.projectId) {
    threadClauses.push('t.project_id = ?');
    threadParameters.push(input.projectId);
  }
  if (input.sectionId) {
    threadClauses.push('t.section_id = ?');
    threadParameters.push(input.sectionId);
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
      database
        .prepare(
          `${threadOptionSelect}
           WHERE ${threadClauses.join(' AND ')}
           ORDER BY t.updated_at_ms DESC, t.thread_id
           LIMIT ?`,
        )
        .all(...threadParameters, MAX_FILTER_THREADS + 1),
    );
  return {
    projects: projectRows.slice(0, MAX_FILTER_PROJECTS),
    sections,
    recentThreads: recentRows.map(threadOption),
    threads: threadRows.slice(0, MAX_FILTER_THREADS).map(threadOption),
    threadsTruncated: threadRows.length > MAX_FILTER_THREADS,
  };
}

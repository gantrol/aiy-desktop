import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { CodexVisualizationDateRange } from '@/shared/contracts/codex-visualizations';
import type {
  CodexVisualizationSessionRecord,
  CodexVisualizationThreadArtifactRecord,
} from '@/main/extensions/codex-visualization-discovery/scan';
import { extractMessageDiagrams } from '@/main/extensions/codex-visualization-discovery/thread-diagram-extraction';

const THREAD_HISTORY_DATABASE_PATTERN = /^thread_history_(\d+)\.sqlite$/;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_ITEM_JSON_BYTES = MAX_RECORD_BYTES + 16 * 1024;
const MAX_CANDIDATE_MESSAGES = 20_000;
const MAX_COVERED_SESSIONS = 100_000;
const MAX_ARTIFACTS_PER_SESSION = 64;
const DIAGRAM_FENCE_PREFIXES = [
  '```mermaid',
  '```mmd',
  '```plantuml',
  '```puml',
  '```uml',
  '```graphviz',
  '```dot',
  '```d2',
];

const sessionIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
const tableColumnSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
const coveredSessionRowSchema = z.object({ threadId: sessionIdSchema }).strict();
const indexedMessageRowSchema = z
  .object({
    threadId: sessionIdSchema,
    itemId: z.string().min(1).max(256),
    createdAtMs: z.number().int().nonnegative().safe(),
    itemJson: z.string().min(2).max(MAX_ITEM_JSON_BYTES),
  })
  .strict();
const indexedAgentMessageSchema = z
  .object({
    type: z.literal('agentMessage'),
    id: z.string().min(1).max(256).optional(),
    text: z.string().max(MAX_RECORD_BYTES),
    phase: z.string().max(64).nullable().optional(),
  })
  .passthrough();

export type IndexedThreadDiagramScanResult =
  | { status: 'UNAVAILABLE' }
  | {
      status: 'AVAILABLE';
      coveredSessionIds: ReadonlySet<string>;
      sessions: CodexVisualizationSessionRecord[];
    };

function pathContainsTrash(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function scanExpired(deadlineMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return Date.now() >= deadlineMs;
}

function localDateStart(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    throw new Error('Invalid Codex visualization date');
  }
  return date;
}

function rangeEpochs(range: CodexVisualizationDateRange) {
  const from = localDateStart(range.from);
  const toExclusive = localDateStart(range.to);
  toExclusive.setDate(toExclusive.getDate() + 1);
  return { fromEpochMs: from.getTime(), toExclusiveEpochMs: toExclusive.getTime() };
}

async function currentThreadHistoryDatabase(codexHome: string) {
  let entries;
  try {
    entries = await readdir(codexHome, { withFileTypes: true });
  } catch {
    return null;
  }
  const databasePath =
    entries
      .flatMap((entry) => {
        const version =
          entry.isFile() && !entry.isSymbolicLink() ? entry.name.match(THREAD_HISTORY_DATABASE_PATTERN)?.[1] : null;
        return version ? [{ name: entry.name, version: Number(version) }] : [];
      })
      .sort((left, right) => right.version - left.version)
      .map(({ name }) => path.join(codexHome, name))[0] ?? null;
  if (!databasePath || pathContainsTrash(databasePath)) return null;
  try {
    const metadata = await lstat(databasePath);
    return metadata.isFile() && !metadata.isSymbolicLink() ? databasePath : null;
  } catch {
    return null;
  }
}

function tableColumns(database: Database.Database, table: string) {
  return new Set(
    z
      .array(tableColumnSchema)
      .parse(database.prepare(`PRAGMA table_info(${table})`).all())
      .map(({ name }) => name),
  );
}

function supportsThreadHistorySchema(database: Database.Database) {
  const itemColumns = tableColumns(database, 'thread_items');
  const projectionColumns = tableColumns(database, 'thread_history_projection_state');
  return (
    ['thread_id', 'item_id', 'created_at_ms', 'item_json', 'item_type', 'rollout_ordinal'].every((column) =>
      itemColumns.has(column),
    ) && projectionColumns.has('thread_id')
  );
}

function readCoveredSessionIds(database: Database.Database) {
  const rows = z
    .array(coveredSessionRowSchema)
    .max(MAX_COVERED_SESSIONS + 1)
    .parse(
      database
        .prepare(
          `SELECT thread_id AS threadId
           FROM thread_history_projection_state
           LIMIT ?`,
        )
        .all(MAX_COVERED_SESSIONS + 1),
    );
  if (rows.length > MAX_COVERED_SESSIONS) return null;
  return new Set(rows.map(({ threadId }) => threadId.toLowerCase()));
}

function readCandidateMessages(database: Database.Database, range: CodexVisualizationDateRange) {
  const { fromEpochMs, toExclusiveEpochMs } = rangeEpochs(range);
  const fenceConditions = DIAGRAM_FENCE_PREFIXES.map(() => 'instr(lower(item_json), ?) > 0').join(' OR ');
  const rows = z
    .array(indexedMessageRowSchema)
    .max(MAX_CANDIDATE_MESSAGES + 1)
    .parse(
      database
        .prepare(
          `SELECT
             thread_id AS threadId,
             item_id AS itemId,
             created_at_ms AS createdAtMs,
             item_json AS itemJson
           FROM thread_items
           WHERE item_type = 'agentMessage'
             AND created_at_ms >= ?
             AND created_at_ms < ?
             AND length(item_json) BETWEEN 2 AND ?
             AND (${fenceConditions})
           ORDER BY created_at_ms DESC, rollout_ordinal DESC
           LIMIT ?`,
        )
        .all(
          fromEpochMs,
          toExclusiveEpochMs,
          MAX_ITEM_JSON_BYTES,
          ...DIAGRAM_FENCE_PREFIXES,
          MAX_CANDIDATE_MESSAGES + 1,
        ),
    );
  return rows.slice(0, MAX_CANDIDATE_MESSAGES);
}

function indexedSessions(
  rows: readonly z.infer<typeof indexedMessageRowSchema>[],
  deadlineMs: number,
  signal?: AbortSignal,
) {
  const artifactsBySession = new Map<string, CodexVisualizationThreadArtifactRecord[]>();
  for (const row of rows) {
    if (scanExpired(deadlineMs, signal)) break;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(row.itemJson) as unknown;
    } catch {
      continue;
    }
    const parsed = indexedAgentMessageSchema.safeParse(parsedJson);
    if (!parsed.success || (parsed.data.phase && parsed.data.phase !== 'final_answer')) continue;
    const sessionId = row.threadId.toLowerCase();
    const artifacts = extractMessageDiagrams(
      sessionId,
      parsed.data.id ?? row.itemId,
      new Date(row.createdAtMs).toISOString(),
      parsed.data.text,
    );
    if (!artifacts.length) continue;
    const existing = artifactsBySession.get(sessionId) ?? [];
    existing.push(...artifacts);
    artifactsBySession.set(sessionId, existing);
  }
  return [...artifactsBySession.entries()]
    .flatMap(([sessionId, artifacts]): CodexVisualizationSessionRecord[] => {
      const uniqueArtifacts = [...new Map(artifacts.map((artifact) => [artifact.id, artifact])).values()]
        .sort(
          (left, right) =>
            right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath),
        )
        .slice(0, MAX_ARTIFACTS_PER_SESSION);
      return uniqueArtifacts.length
        ? [{ sessionId, directoryPath: null, modifiedAt: uniqueArtifacts[0]!.modifiedAt, artifacts: uniqueArtifacts }]
        : [];
    })
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function scanIndexedCodexThreadDiagrams(
  codexHome: string,
  range: CodexVisualizationDateRange,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<IndexedThreadDiagramScanResult> {
  if (pathContainsTrash(codexHome) || scanExpired(deadlineMs, signal)) return { status: 'UNAVAILABLE' };
  const databasePath = await currentThreadHistoryDatabase(codexHome);
  if (!databasePath || scanExpired(deadlineMs, signal)) return { status: 'UNAVAILABLE' };
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
    database.pragma('query_only = ON');
    if (!supportsThreadHistorySchema(database)) return { status: 'UNAVAILABLE' };
    const coveredSessionIds = readCoveredSessionIds(database);
    if (!coveredSessionIds) return { status: 'UNAVAILABLE' };
    const rows = readCandidateMessages(database, range);
    return {
      status: 'AVAILABLE',
      coveredSessionIds,
      sessions: indexedSessions(rows, deadlineMs, signal),
    };
  } catch (reason) {
    if (signal?.aborted) throw reason;
    return { status: 'UNAVAILABLE' };
  } finally {
    database?.close();
  }
}

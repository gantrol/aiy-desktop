import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';

const MAX_INDEXED_THREADS = 100_000;
const FILE_VALIDATION_CONCURRENCY = 12;

const tableColumnSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
const indexedThreadSchema = z
  .object({
    id: z.string().min(1).max(512),
    rolloutPath: z.string().min(1).max(32_000),
    createdAtMs: z.number().int().nonnegative().safe(),
    updatedAtMs: z.number().int().nonnegative().safe(),
    tokensUsed: z.number().int().positive().safe(),
    model: z.string().max(200).nullable(),
    threadSource: z.string().trim().max(200).nullable(),
  })
  .strict();

export type CodexUsageThreadSource = 'USER' | 'SUBAGENT' | 'OTHER';

export interface IndexedCodexUsageFile {
  filePath: string;
  sessionId: string;
  fallbackModel: string | null;
  threadSource: CodexUsageThreadSource;
  createdAtMs: number;
  size: number;
  mtimeMs: number;
  mtimeNs: string;
  ctimeNs: string;
}

export type CodexThreadIndexResult =
  { status: 'UNAVAILABLE' } | { status: 'AVAILABLE'; files: IndexedCodexUsageFile[]; skipped: number };

type IndexedFileValidation = { status: 'FILE'; file: IndexedCodexUsageFile } | { status: 'IGNORED' } | null;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Codex usage scan cancelled'), { name: 'AbortError' });
  }
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function hasForbiddenSegment(candidate: string) {
  return candidate.split(path.sep).some((segment) => segment.toLowerCase().includes('trash'));
}

async function currentStateDatabase(codexHome: string) {
  let entries;
  try {
    entries = await readdir(codexHome, { withFileTypes: true });
  } catch {
    return null;
  }
  return (
    entries
      .flatMap((entry) => {
        const version = entry.isFile() ? entry.name.match(/^state_(\d+)\.sqlite$/)?.[1] : null;
        return version ? [{ name: entry.name, version: Number(version) }] : [];
      })
      .sort((left, right) => right.version - left.version)
      .map(({ name }) => path.join(codexHome, name))[0] ?? null
  );
}

function readIndexedThreads(databasePath: string) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    const columns = new Set(
      z
        .array(tableColumnSchema)
        .parse(database.prepare('PRAGMA table_info(threads)').all())
        .map(({ name }) => name),
    );
    if (!['id', 'rollout_path', 'updated_at', 'tokens_used'].every((column) => columns.has(column))) return null;
    const updatedAtExpression = columns.has('updated_at_ms')
      ? 'COALESCE(updated_at_ms, updated_at * 1000)'
      : 'updated_at * 1000';
    const createdAtExpression = columns.has('created_at_ms')
      ? columns.has('created_at')
        ? `COALESCE(created_at_ms, created_at * 1000, ${updatedAtExpression})`
        : `COALESCE(created_at_ms, ${updatedAtExpression})`
      : columns.has('created_at')
        ? `COALESCE(created_at * 1000, ${updatedAtExpression})`
        : updatedAtExpression;
    const modelExpression = columns.has('model') ? 'model' : 'NULL';
    const threadSourceExpression = columns.has('thread_source') ? 'thread_source' : 'NULL';
    const statement = database.prepare(`
      SELECT
        id,
        rollout_path AS rolloutPath,
        ${createdAtExpression} AS createdAtMs,
        ${updatedAtExpression} AS updatedAtMs,
        tokens_used AS tokensUsed,
        ${modelExpression} AS model,
        ${threadSourceExpression} AS threadSource
      FROM threads
      WHERE tokens_used > 0
        AND rollout_path <> ''
      ORDER BY ${updatedAtExpression} DESC
      LIMIT ${MAX_INDEXED_THREADS + 1}
    `);
    return z.array(indexedThreadSchema).parse(statement.all());
  } finally {
    database.close();
  }
}

function normalizedThreadSource(value: string | null): CodexUsageThreadSource {
  if (value === 'user') return 'USER';
  if (value === 'subagent') return 'SUBAGENT';
  return 'OTHER';
}

async function safeRolloutRoots(codexHome: string) {
  const lexicalRoots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  const roots = await Promise.all(
    lexicalRoots.map(async (lexical) => {
      try {
        return { lexical, real: await realpath(lexical) };
      } catch {
        return null;
      }
    }),
  );
  return roots.filter((root): root is { lexical: string; real: string } => root !== null);
}

async function validateIndexedFile(
  row: z.infer<typeof indexedThreadSchema>,
  roots: readonly { lexical: string; real: string }[],
  fromEpoch: number | null,
): Promise<IndexedFileValidation> {
  if (!path.isAbsolute(row.rolloutPath)) return null;
  const filePath = path.resolve(row.rolloutPath);
  if (hasForbiddenSegment(filePath)) return null;
  const owningRoot = roots.find((root) => isWithin(root.lexical, filePath));
  if (!owningRoot) return null;
  try {
    const metadata = await lstat(filePath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const realFile = await realpath(filePath);
    if (!isWithin(owningRoot.real, realFile)) return null;
    const mtimeMs = Number(metadata.mtimeNs / 1_000_000n);
    if (fromEpoch !== null && row.updatedAtMs < fromEpoch && mtimeMs < fromEpoch) return { status: 'IGNORED' };
    return {
      status: 'FILE',
      file: {
        filePath: realFile,
        sessionId: row.id,
        fallbackModel: row.model,
        threadSource: normalizedThreadSource(row.threadSource),
        createdAtMs: row.createdAtMs,
        size: Number(metadata.size),
        mtimeMs,
        mtimeNs: metadata.mtimeNs.toString(),
        ctimeNs: metadata.ctimeNs.toString(),
      },
    };
  } catch {
    return null;
  }
}

export async function discoverCodexUsageFromThreadIndex(
  codexHome: string,
  fromEpoch: number | null,
  signal?: AbortSignal,
): Promise<CodexThreadIndexResult> {
  throwIfAborted(signal);
  const databasePath = await currentStateDatabase(codexHome);
  if (!databasePath) return { status: 'UNAVAILABLE' };
  let rows: z.infer<typeof indexedThreadSchema>[] | null;
  try {
    rows = readIndexedThreads(databasePath);
  } catch {
    return { status: 'UNAVAILABLE' };
  }
  if (!rows) return { status: 'UNAVAILABLE' };
  const overflow = Math.max(0, rows.length - MAX_INDEXED_THREADS);
  const boundedRows = rows.slice(0, MAX_INDEXED_THREADS);
  const roots = await safeRolloutRoots(codexHome);
  const files: IndexedCodexUsageFile[] = [];
  let skipped = overflow;
  for (let offset = 0; offset < boundedRows.length; offset += FILE_VALIDATION_CONCURRENCY) {
    throwIfAborted(signal);
    const batch = boundedRows.slice(offset, offset + FILE_VALIDATION_CONCURRENCY);
    const validated = await Promise.all(batch.map((row) => validateIndexedFile(row, roots, fromEpoch)));
    for (const result of validated) {
      if (result?.status === 'FILE') files.push(result.file);
      else if (!result) skipped += 1;
    }
  }
  return { status: 'AVAILABLE', files, skipped };
}

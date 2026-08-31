import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { CodexHistoryThreadSource } from '@/shared/contracts/codex-history-search';

const STATE_DATABASE_PATTERN = /^state_(\d+)\.sqlite$/;
const THREAD_HISTORY_DATABASE_PATTERN = /^thread_history_(\d+)\.sqlite$/;
const MAX_THREADS = 100_000;
const MESSAGE_PAGE_SIZE = 500;
const MAX_MESSAGE_ITEMS = 250_000;
const MAX_ITEM_JSON_BYTES = 4 * 1024 * 1024 + 16 * 1024;
const MAX_SOURCE_MESSAGE_TEXT_CHARACTERS = 4 * 1024 * 1024;
const MAX_INDEXED_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;
const MAX_METADATA_TEXT_CHARACTERS = 64 * 1024;
const MAX_PROJECT_ROWS = 10_000;

const tableColumnSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
const indexedThreadRowSchema = z
  .object({
    threadId: z.string().min(1).max(512),
    createdAtMs: z.number().int().nonnegative().safe(),
    updatedAtMs: z.number().int().nonnegative().safe(),
    title: z.string().max(65_536).nullable(),
    name: z.string().max(65_536).nullable(),
    firstUserMessage: z
      .string()
      .max(MAX_METADATA_TEXT_CHARACTERS * 2)
      .nullable(),
    preview: z
      .string()
      .max(MAX_METADATA_TEXT_CHARACTERS * 2)
      .nullable(),
    archived: z.number().int().min(0).max(1),
    threadSource: z.string().trim().max(200).nullable(),
    sourceDescriptor: z.string().max(65_536).nullable(),
    workspace: z.string().max(65_536).nullable(),
    branch: z.string().max(2_048).nullable(),
    projectId: z.string().trim().max(512).nullable(),
    gitOriginUrl: z.string().max(65_536).nullable(),
  })
  .strict();
const indexedProjectRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    projectName: z.string().max(65_536),
    projectRoot: z.string().max(65_536).nullable(),
  })
  .strict();
const indexedMessageRowSchema = z
  .object({
    sourceRowId: z.number().int().positive().safe(),
    threadId: z.string().min(1).max(512),
    itemId: z.string().min(1).max(512),
    createdAtMs: z.number().int().nonnegative().safe(),
    itemType: z.enum(['userMessage', 'agentMessage']),
    itemJson: z.string().min(2).max(MAX_ITEM_JSON_BYTES),
  })
  .strict();
const userTextPartSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
  })
  .passthrough();
const indexedUserMessageSchema = z
  .object({
    type: z.literal('userMessage'),
    content: z.array(z.unknown()).max(256),
  })
  .passthrough();
const indexedAgentMessageSchema = z
  .object({
    type: z.literal('agentMessage'),
    text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
    phase: z.string().max(64).nullable().optional(),
  })
  .passthrough();

export interface CodexHistorySourcePaths {
  stateDatabasePath: string;
  threadHistoryDatabasePath: string;
  signature: string;
}

export interface CodexHistorySourceThread {
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
  preview: string;
  metadataText: string;
}

export interface CodexHistorySourceMessage {
  sourceRowId: number;
  threadId: string;
  role: 'USER' | 'ASSISTANT';
  createdAtMs: number;
  text: string;
}

export interface CodexHistorySourceSnapshot {
  paths: CodexHistorySourcePaths;
  threads: CodexHistorySourceThread[];
  messages: CodexHistorySourceMessage[];
}

function pathContainsForbiddenSegment(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function normalizedText(value: string | null, maximumCharacters: number) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximumCharacters);
}

function normalizedThreadSource(value: string | null, sourceDescriptor: string | null): CodexHistoryThreadSource {
  if (value === 'subagent' || sourceDescriptor?.includes('"subagent"')) return 'SUBAGENT';
  return 'USER';
}

interface IndexedProject {
  projectId: string;
  projectName: string;
  roots: string[];
}

interface IndexedProjectCatalog {
  byId: Map<string, IndexedProject>;
  derived: Map<string, IndexedProject>;
  roots: Array<{ project: IndexedProject; root: string }>;
}

function readProjects(database: Database.Database): IndexedProjectCatalog {
  const projectColumns = tableColumns(database, 'projects');
  if (!['id', 'name'].every((column) => projectColumns.has(column))) {
    return { byId: new Map(), derived: new Map(), roots: [] };
  }
  const rootColumns = tableColumns(database, 'project_roots');
  const rootJoin = ['project_id', 'path'].every((column) => rootColumns.has(column));
  const projectOrder = projectColumns.has('position') ? 'p.position, p.id' : 'p.id';
  const rootOrder = rootColumns.has('position') ? ', r.position' : ', r.path';
  const rows = z
    .array(indexedProjectRowSchema)
    .max(MAX_PROJECT_ROWS)
    .parse(
      database
        .prepare(
          rootJoin
            ? `SELECT
                 p.id AS projectId,
                 substr(COALESCE(p.name, p.id), 1, 32768) AS projectName,
                 substr(r.path, 1, 32768) AS projectRoot
               FROM projects AS p
               LEFT JOIN project_roots AS r ON r.project_id = p.id
               ORDER BY ${projectOrder}${rootOrder}`
            : `SELECT
                 p.id AS projectId,
                 substr(COALESCE(p.name, p.id), 1, 32768) AS projectName,
                 NULL AS projectRoot
               FROM projects AS p
               ORDER BY ${projectOrder}`,
        )
        .all(),
    );
  const projects = new Map<string, IndexedProject>();
  for (const row of rows) {
    const project = projects.get(row.projectId) ?? {
      projectId: row.projectId,
      projectName: normalizedText(row.projectName, 500) || normalizedText(row.projectId, 500),
      roots: [],
    };
    const root = normalizedText(row.projectRoot, 32_768);
    if (root && path.isAbsolute(root)) project.roots.push(path.normalize(root));
    projects.set(row.projectId, project);
  }
  return {
    byId: projects,
    derived: new Map(),
    roots: [...projects.values()]
      .flatMap((project) => project.roots.map((root) => ({ project, root })))
      .sort((left, right) => right.root.length - left.root.length),
  };
}

function resolvedProject(
  explicitProjectId: string | null,
  workspace: string,
  gitOriginUrl: string,
  projects: IndexedProjectCatalog,
) {
  const explicit = explicitProjectId ? projects.byId.get(explicitProjectId) : undefined;
  if (explicit) return explicit;
  if (explicitProjectId) {
    return { projectId: explicitProjectId, projectName: normalizedText(explicitProjectId, 500), roots: [] };
  }
  if (workspace && path.isAbsolute(workspace)) {
    const normalizedWorkspace = path.normalize(workspace);
    const matched = projects.roots.find(({ root }) => {
      const relative = path.relative(root, normalizedWorkspace);
      return (
        relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    })?.project;
    if (matched) return matched;
  }
  const workspaceName =
    workspace && path.isAbsolute(workspace) ? normalizedText(path.basename(path.normalize(workspace)), 500) : '';
  if (gitOriginUrl) {
    const derivedKey = `git:${gitOriginUrl}`;
    const cached = projects.derived.get(derivedKey);
    if (cached) return cached;
    const originWithoutSuffix = gitOriginUrl
      .split(/[?#]/, 1)[0]!
      .replace(/[\\/]+$/, '')
      .replace(/\.git$/i, '');
    const separator = Math.max(originWithoutSuffix.lastIndexOf('/'), originWithoutSuffix.lastIndexOf(':'));
    const originName = normalizedText(originWithoutSuffix.slice(separator + 1), 500);
    const project = {
      projectId: `git:${createHash('sha256').update(gitOriginUrl).digest('hex')}`,
      projectName: originName || workspaceName || 'Git project',
      roots: [],
    };
    projects.derived.set(derivedKey, project);
    return project;
  }
  if (workspace) {
    const workspaceIdentity = process.platform === 'win32' ? workspace.toLocaleLowerCase() : workspace;
    const derivedKey = `workspace:${workspaceIdentity}`;
    const cached = projects.derived.get(derivedKey);
    if (cached) return cached;
    const project = {
      projectId: `workspace:${createHash('sha256').update(workspaceIdentity).digest('hex')}`,
      projectName: workspaceName || normalizedText(workspace, 500),
      roots: [],
    };
    projects.derived.set(derivedKey, project);
    return project;
  }
  return { projectId: '', projectName: '', roots: [] };
}

async function currentDatabase(codexHome: string, pattern: RegExp) {
  let entries;
  try {
    entries = await readdir(codexHome, { withFileTypes: true });
  } catch {
    return null;
  }
  const selected = entries
    .flatMap((entry) => {
      const version = entry.isFile() && !entry.isSymbolicLink() ? entry.name.match(pattern)?.[1] : null;
      return version ? [{ name: entry.name, version: Number(version) }] : [];
    })
    .sort((left, right) => right.version - left.version)[0];
  if (!selected) return null;
  const candidate = path.join(codexHome, selected.name);
  if (pathContainsForbiddenSegment(candidate)) return null;
  try {
    const metadata = await lstat(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() ? { path: candidate, metadata } : null;
  } catch {
    return null;
  }
}

export async function discoverCodexHistorySources(codexHome: string): Promise<CodexHistorySourcePaths | null> {
  const resolvedHome = path.resolve(codexHome);
  if (pathContainsForbiddenSegment(resolvedHome)) return null;
  const [stateDatabase, threadHistoryDatabase] = await Promise.all([
    currentDatabase(resolvedHome, STATE_DATABASE_PATTERN),
    currentDatabase(resolvedHome, THREAD_HISTORY_DATABASE_PATTERN),
  ]);
  if (!stateDatabase || !threadHistoryDatabase) return null;
  const mutableFileSignature = async (databasePath: string, size: number, mtimeMs: number) => {
    try {
      const wal = await lstat(`${databasePath}-wal`);
      return [databasePath, size, mtimeMs, wal.isFile() && !wal.isSymbolicLink() ? wal.size : 0, wal.mtimeMs];
    } catch {
      return [databasePath, size, mtimeMs, 0, 0];
    }
  };
  const [stateSignature, historySignature] = await Promise.all([
    mutableFileSignature(stateDatabase.path, stateDatabase.metadata.size, stateDatabase.metadata.mtimeMs),
    mutableFileSignature(
      threadHistoryDatabase.path,
      threadHistoryDatabase.metadata.size,
      threadHistoryDatabase.metadata.mtimeMs,
    ),
  ]);
  const signature = createHash('sha256')
    .update([...stateSignature, ...historySignature].join('\n'))
    .digest('hex');
  return {
    stateDatabasePath: stateDatabase.path,
    threadHistoryDatabasePath: threadHistoryDatabase.path,
    signature,
  };
}

function tableColumns(database: Database.Database, table: string) {
  return new Set(
    z
      .array(tableColumnSchema)
      .parse(database.prepare(`PRAGMA table_info(${table})`).all())
      .map(({ name }) => name),
  );
}

function readThreads(databasePath: string, signal: AbortSignal) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    database.pragma('query_only = ON');
    const columns = tableColumns(database, 'threads');
    if (!['id', 'updated_at'].every((column) => columns.has(column))) {
      throw new Error('Codex task metadata database has an unsupported schema');
    }
    const updatedAtExpression = columns.has('updated_at_ms')
      ? 'COALESCE(updated_at_ms, updated_at * 1000, 0)'
      : 'COALESCE(updated_at * 1000, 0)';
    const createdAtExpression = columns.has('created_at_ms')
      ? columns.has('created_at')
        ? `COALESCE(created_at_ms, created_at * 1000, ${updatedAtExpression})`
        : `COALESCE(created_at_ms, ${updatedAtExpression})`
      : columns.has('created_at')
        ? `COALESCE(created_at * 1000, ${updatedAtExpression})`
        : updatedAtExpression;
    const expression = (column: string, fallback: string) => (columns.has(column) ? column : fallback);
    const textExpression = (column: string, maximumCharacters: number) =>
      columns.has(column) ? `substr(${column}, 1, ${maximumCharacters})` : 'NULL';
    signal.throwIfAborted();
    const projects = readProjects(database);
    const rows = z
      .array(indexedThreadRowSchema)
      .max(MAX_THREADS + 1)
      .parse(
        database
          .prepare(
            `SELECT
               id AS threadId,
               ${createdAtExpression} AS createdAtMs,
               ${updatedAtExpression} AS updatedAtMs,
               ${textExpression('title', 32_768)} AS title,
               ${textExpression('name', 32_768)} AS name,
               ${textExpression('first_user_message', MAX_METADATA_TEXT_CHARACTERS)} AS firstUserMessage,
               ${textExpression('preview', MAX_METADATA_TEXT_CHARACTERS)} AS preview,
               ${expression('archived', '0')} AS archived,
               ${textExpression('thread_source', 200)} AS threadSource,
               ${textExpression('source', 32_768)} AS sourceDescriptor,
               ${textExpression('cwd', 32_768)} AS workspace,
               ${textExpression('git_branch', 1_024)} AS branch,
               ${textExpression('project_id', 512)} AS projectId,
               ${textExpression('git_origin_url', 32_768)} AS gitOriginUrl
             FROM threads
             ORDER BY ${updatedAtExpression} DESC
             LIMIT ?`,
          )
          .all(MAX_THREADS + 1),
      );
    if (rows.length > MAX_THREADS) throw new Error('Codex task metadata exceeds the local index limit');
    return rows.map((row): CodexHistorySourceThread => {
      const explicitTitle = normalizedText(row.title || row.name, 500);
      const firstUserMessage = normalizedText(row.firstUserMessage, MAX_METADATA_TEXT_CHARACTERS);
      const preview = normalizedText(row.preview, MAX_METADATA_TEXT_CHARACTERS);
      const title = explicitTitle || firstUserMessage.slice(0, 500) || 'Untitled Codex task';
      const workspace = normalizedText(row.workspace, 32_768);
      const branch = normalizedText(row.branch, 1_024);
      const gitOriginUrl = normalizedText(row.gitOriginUrl, 32_768);
      const project = resolvedProject(row.projectId, workspace, gitOriginUrl, projects);
      return {
        threadId: row.threadId.toLowerCase(),
        title,
        titleAvailable: Boolean(explicitTitle),
        projectId: project.projectId,
        projectName: project.projectName,
        workspace,
        branch,
        archived: row.archived === 1,
        source: normalizedThreadSource(row.threadSource, row.sourceDescriptor),
        createdAtMs: row.createdAtMs,
        updatedAtMs: row.updatedAtMs,
        preview,
        metadataText: normalizedText(
          [...new Set([title, firstUserMessage, preview, project.projectName, workspace, branch].filter(Boolean))].join(
            '\n',
          ),
          MAX_METADATA_TEXT_CHARACTERS,
        ),
      };
    });
  } finally {
    database.close();
  }
}

function parsedMessage(row: z.infer<typeof indexedMessageRowSchema>): CodexHistorySourceMessage | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.itemJson) as unknown;
  } catch {
    return null;
  }
  if (row.itemType === 'agentMessage') {
    const parsed = indexedAgentMessageSchema.safeParse(decoded);
    if (!parsed.success || (parsed.data.phase && parsed.data.phase !== 'final_answer')) return null;
    const text = parsed.data.text.trim().slice(0, MAX_INDEXED_MESSAGE_TEXT_CHARACTERS);
    return text
      ? {
          sourceRowId: row.sourceRowId,
          threadId: row.threadId.toLowerCase(),
          role: 'ASSISTANT',
          createdAtMs: row.createdAtMs,
          text,
        }
      : null;
  }
  const parsed = indexedUserMessageSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const text = parsed.data.content
    .flatMap((part) => {
      const candidate = userTextPartSchema.safeParse(part);
      return candidate.success ? [candidate.data.text] : [];
    })
    .join('\n')
    .trim()
    .slice(0, MAX_INDEXED_MESSAGE_TEXT_CHARACTERS);
  return text
    ? {
        sourceRowId: row.sourceRowId,
        threadId: row.threadId.toLowerCase(),
        role: 'USER',
        createdAtMs: row.createdAtMs,
        text,
      }
    : null;
}

async function readMessages(databasePath: string, signal: AbortSignal, onProgress: (progress: number) => void) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    database.pragma('query_only = ON');
    const columns = tableColumns(database, 'thread_items');
    if (!['thread_id', 'item_id', 'created_at_ms', 'item_json', 'item_type'].every((column) => columns.has(column))) {
      throw new Error('Codex task history database has an unsupported schema');
    }
    const total = z
      .object({ count: z.number().int().nonnegative().safe() })
      .strict()
      .parse(
        database
          .prepare("SELECT COUNT(*) AS count FROM thread_items WHERE item_type IN ('userMessage', 'agentMessage')")
          .get(),
      ).count;
    if (total > MAX_MESSAGE_ITEMS) throw new Error('Codex task history exceeds the local index limit');
    const statement = database.prepare(
      `SELECT
         rowid AS sourceRowId,
         thread_id AS threadId,
         item_id AS itemId,
         created_at_ms AS createdAtMs,
         item_type AS itemType,
         item_json AS itemJson
       FROM thread_items
       WHERE item_type IN ('userMessage', 'agentMessage')
         AND rowid > ?
         AND length(CAST(item_json AS BLOB)) BETWEEN 2 AND ?
       ORDER BY rowid ASC
       LIMIT ?`,
    );
    const messages: CodexHistorySourceMessage[] = [];
    let sourceRowId = 0;
    let inspected = 0;
    while (inspected < total) {
      signal.throwIfAborted();
      const rows = z
        .array(indexedMessageRowSchema)
        .max(MESSAGE_PAGE_SIZE)
        .parse(statement.all(sourceRowId, MAX_ITEM_JSON_BYTES, MESSAGE_PAGE_SIZE));
      if (!rows.length) break;
      for (const row of rows) {
        sourceRowId = row.sourceRowId;
        const message = parsedMessage(row);
        if (message) messages.push(message);
      }
      inspected += rows.length;
      onProgress(total ? Math.min(100, Math.round((inspected / total) * 100)) : 100);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return messages;
  } finally {
    database.close();
  }
}

export async function readCodexHistorySourceSnapshot(
  paths: CodexHistorySourcePaths,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<CodexHistorySourceSnapshot> {
  signal.throwIfAborted();
  const threads = readThreads(paths.stateDatabasePath, signal);
  onProgress(15);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const messages = await readMessages(paths.threadHistoryDatabasePath, signal, (progress) =>
    onProgress(15 + Math.round(progress * 0.65)),
  );
  const threadIds = new Set(threads.map(({ threadId }) => threadId));
  return {
    paths,
    threads,
    messages: messages.filter(({ threadId }) => threadIds.has(threadId)),
  };
}

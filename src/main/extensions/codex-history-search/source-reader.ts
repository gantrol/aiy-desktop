import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { CodexHistoryThreadSource } from '@/shared/contracts/codex-history-search';

const STATE_DATABASE_PATTERN = /^state_(\d+)\.sqlite$/;
const THREAD_HISTORY_DATABASE_PATTERN = /^thread_history_(\d+)\.sqlite$/;
const MAX_THREADS = 100_000;
const THREAD_LOOKUP_BATCH_SIZE = 500;
const MESSAGE_PAGE_SIZE = 500;
const MAX_MESSAGE_PAGE_BYTES = 32 * 1024 * 1024;
const MAX_MESSAGE_ITEMS = 250_000;
const MAX_ITEM_JSON_BYTES = 4 * 1024 * 1024 + 16 * 1024;
const MAX_SOURCE_MESSAGE_TEXT_CHARACTERS = 4 * 1024 * 1024;
const MAX_INDEXED_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;
const MAX_METADATA_TEXT_CHARACTERS = 64 * 1024;
const MAX_PROJECT_ROWS = 10_000;
const MAX_SECTIONS = 1_000;

const tableColumnSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
const sourceThreadCountRowSchema = z.object({ count: z.number().int().nonnegative().safe() }).strict();
const sourceThreadTimestampRowSchema = z
  .object({ updatedAt: z.number().int().nonnegative().safe().nullable() })
  .strict();
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
    sectionId: z.string().trim().max(512).nullable(),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    pinned: z.number().int().min(0).max(1),
  })
  .strict();
const indexedProjectRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    projectName: z.string().max(65_536),
    projectRoot: z.string().max(65_536).nullable(),
    projectPosition: z.number().int().nonnegative().safe(),
    rootPosition: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();
const indexedSectionRowSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(512),
    sectionName: z.string().max(65_536),
    sectionPosition: z.number().int().nonnegative().safe(),
  })
  .strict();
const indexedOrganizationRowSchema = z
  .object({
    threadId: z.string().min(1).max(512),
    sectionId: z.string().trim().max(512).nullable(),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    pinned: z.number().int().min(0).max(1),
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
  stateSourceId: string;
  historySourceId: string;
  signature: string;
}

export interface CodexHistorySourceCursor {
  historyRowId: number;
  threadUpdatedAtMs: number;
  threadCount: number;
  projectSignature: string | null;
  fullThreads: boolean;
}

export interface CodexHistorySourceThread {
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
  preview: string;
  metadataText: string;
}

export interface CodexHistorySourceProject {
  projectId: string;
  name: string;
  workspace: string;
  position: number;
}

export interface CodexHistorySourceSection {
  sectionId: string;
  name: string;
  position: number;
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
  projects: CodexHistorySourceProject[];
  sections: CodexHistorySourceSection[];
  scannedThroughRowId: number;
  sourceReset: boolean;
  fullThreadSnapshot: boolean;
  sourceThreadUpdatedAtMs: number;
  sourceThreadCount: number;
  sourceProjectSignature: string;
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
  position: number;
  roots: Array<{ workspace: string; canonical: string }>;
}

interface IndexedProjectCatalog {
  byId: Map<string, IndexedProject>;
  projects: IndexedProject[];
  roots: Array<{ project: IndexedProject; canonical: string }>;
  signature: string;
}

function valueSignature(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex');
}

function withoutWindowsExtendedPathPrefix(value: string) {
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  if (/^\\\\\?\\/i.test(value)) return value.slice(4);
  return value;
}

function normalizedAbsolutePath(value: string) {
  const candidate = withoutWindowsExtendedPathPrefix(value);
  if (!path.isAbsolute(candidate)) return null;
  const workspace = path.normalize(candidate);
  return {
    workspace,
    canonical: process.platform === 'win32' ? workspace.toLocaleLowerCase() : workspace,
  };
}

function readProjects(database: Database.Database): IndexedProjectCatalog {
  const projectColumns = tableColumns(database, 'projects');
  if (!['id', 'name'].every((column) => projectColumns.has(column))) {
    return { byId: new Map(), projects: [], roots: [], signature: valueSignature([]) };
  }
  const rootColumns = tableColumns(database, 'project_roots');
  const rootJoin = ['project_id', 'path'].every((column) => rootColumns.has(column));
  const projectOrder = projectColumns.has('position') ? 'p.position, p.id' : 'p.rowid, p.id';
  const rootOrder = rootColumns.has('position') ? ', r.position' : ', r.rowid';
  const projectPosition = projectColumns.has('position') ? 'MAX(COALESCE(p.position, 0), 0)' : 'MAX(p.rowid - 1, 0)';
  const rootPosition = rootColumns.has('position') ? 'MAX(COALESCE(r.position, 0), 0)' : 'NULL';
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
                 substr(r.path, 1, 32768) AS projectRoot,
                 ${projectPosition} AS projectPosition,
                 ${rootPosition} AS rootPosition
               FROM projects AS p
               LEFT JOIN project_roots AS r ON r.project_id = p.id
               ORDER BY ${projectOrder}${rootOrder}`
            : `SELECT
                 p.id AS projectId,
                 substr(COALESCE(p.name, p.id), 1, 32768) AS projectName,
                 NULL AS projectRoot,
                 ${projectPosition} AS projectPosition,
                 NULL AS rootPosition
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
      position: row.projectPosition,
      roots: [],
    };
    const root = normalizedText(row.projectRoot, 32_768);
    const normalizedRoot = root ? normalizedAbsolutePath(root) : null;
    if (normalizedRoot && !project.roots.some(({ canonical }) => canonical === normalizedRoot.canonical)) {
      project.roots.push(normalizedRoot);
    }
    projects.set(row.projectId, project);
  }
  const orderedProjects = [...projects.values()].sort(
    (left, right) => left.position - right.position || left.projectName.localeCompare(right.projectName),
  );
  return {
    byId: projects,
    projects: orderedProjects,
    roots: orderedProjects
      .flatMap((project) => project.roots.map(({ canonical }) => ({ project, canonical })))
      .sort((left, right) => right.canonical.length - left.canonical.length),
    signature: valueSignature(rows),
  };
}

function resolvedProject(explicitProjectId: string | null, workspace: string, projects: IndexedProjectCatalog) {
  const explicit = explicitProjectId ? projects.byId.get(explicitProjectId) : undefined;
  if (explicit) return explicit;
  const normalizedWorkspace = normalizedAbsolutePath(workspace);
  if (normalizedWorkspace) {
    const matched = projects.roots.find(({ canonical }) => {
      const relative = path.relative(canonical, normalizedWorkspace.canonical);
      return (
        relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    })?.project;
    if (matched) return matched;
  }
  return { projectId: '', projectName: '', position: 0, roots: [] };
}

function readSections(database: Database.Database) {
  const columns = tableColumns(database, 'thread_sections');
  if (!['id', 'name'].every((column) => columns.has(column))) {
    return { byId: new Map<string, CodexHistorySourceSection>(), sections: [] as CodexHistorySourceSection[] };
  }
  const rows = z
    .array(indexedSectionRowSchema)
    .max(MAX_SECTIONS)
    .parse(
      database
        .prepare(
          `SELECT
             id AS sectionId,
             substr(COALESCE(name, id), 1, 32768) AS sectionName,
             ROW_NUMBER() OVER (ORDER BY rowid) - 1 AS sectionPosition
           FROM thread_sections
           ORDER BY rowid`,
        )
        .all(),
    );
  const sections = rows.map((row) => ({
    sectionId: row.sectionId,
    name: normalizedText(row.sectionName, 500) || normalizedText(row.sectionId, 500),
    position: row.sectionPosition,
  }));
  return { byId: new Map(sections.map((section) => [section.sectionId, section])), sections };
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
  const databaseSourceId = (database: NonNullable<Awaited<ReturnType<typeof currentDatabase>>>) =>
    createHash('sha256')
      .update([database.path, database.metadata.dev, database.metadata.ino, database.metadata.birthtimeMs].join('\n'))
      .digest('hex');
  const stateSourceId = databaseSourceId(stateDatabase);
  const historySourceId = databaseSourceId(threadHistoryDatabase);
  return {
    stateDatabasePath: stateDatabase.path,
    threadHistoryDatabasePath: threadHistoryDatabase.path,
    stateSourceId,
    historySourceId,
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

function readThreads(
  databasePath: string,
  cursor: CodexHistorySourceCursor,
  requiredThreadIds: readonly string[],
  signal: AbortSignal,
) {
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
    const sections = readSections(database);
    const sourceThreadCount = sourceThreadCountRowSchema.parse(
      database.prepare('SELECT COUNT(*) AS count FROM threads').get(),
    ).count;
    const organizationRows = z
      .array(indexedOrganizationRowSchema)
      .max(MAX_THREADS)
      .parse(
        database
          .prepare(
            `SELECT
               id AS threadId,
               ${textExpression('thread_section_id', 512)} AS sectionId,
               ${expression('section_position', 'NULL')} AS sectionPosition,
               ${expression('is_pinned', '0')} AS pinned
             FROM threads
             ORDER BY id`,
          )
          .all(),
      );
    const organizationSignature = valueSignature({
      projects: projects.signature,
      sections: sections.sections,
      threads: organizationRows,
    });
    const modernUpdatedAt = columns.has('updated_at_ms')
      ? sourceThreadTimestampRowSchema.parse(
          database.prepare('SELECT MAX(updated_at_ms) AS updatedAt FROM threads').get(),
        ).updatedAt
      : null;
    const legacyUpdatedAt = sourceThreadTimestampRowSchema.parse(
      database.prepare('SELECT MAX(updated_at) AS updatedAt FROM threads').get(),
    ).updatedAt;
    const sourceThreadUpdatedAtMs = Math.max(modernUpdatedAt ?? 0, (legacyUpdatedAt ?? 0) * 1_000);
    const fullSnapshot =
      cursor.fullThreads || sourceThreadCount < cursor.threadCount || cursor.projectSignature !== organizationSignature;
    const changedThreadWhere = fullSnapshot
      ? ''
      : columns.has('updated_at_ms')
        ? 'WHERE updated_at_ms >= ? OR (updated_at_ms IS NULL AND updated_at * 1000 >= ?)'
        : 'WHERE updated_at * 1000 >= ?';
    const changedThreadParameters = fullSnapshot
      ? []
      : columns.has('updated_at_ms')
        ? [cursor.threadUpdatedAtMs, cursor.threadUpdatedAtMs]
        : [cursor.threadUpdatedAtMs];
    const threadSelect = `SELECT
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
       ${textExpression('thread_section_id', 512)} AS sectionId,
       ${expression('section_position', 'NULL')} AS sectionPosition,
       ${expression('is_pinned', '0')} AS pinned
     FROM threads`;
    const changedRows = z
      .array(indexedThreadRowSchema)
      .max(MAX_THREADS + 1)
      .parse(
        database
          .prepare(
            `${threadSelect}
             ${changedThreadWhere}
             LIMIT ?`,
          )
          .all(...changedThreadParameters, MAX_THREADS + 1),
      );
    if (changedRows.length > MAX_THREADS) throw new Error('Codex task metadata exceeds the local index limit');
    const rowsByThreadId = new Map(changedRows.map((row) => [row.threadId.toLowerCase(), row]));
    if (!fullSnapshot) {
      const requiredIds = [...new Set(requiredThreadIds.map((threadId) => threadId.toLowerCase()))];
      if (requiredIds.length > MAX_THREADS) throw new Error('Codex task metadata exceeds the local index limit');
      for (let offset = 0; offset < requiredIds.length; offset += THREAD_LOOKUP_BATCH_SIZE) {
        signal.throwIfAborted();
        const batch = requiredIds.slice(offset, offset + THREAD_LOOKUP_BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(', ');
        const requiredRows = z
          .array(indexedThreadRowSchema)
          .max(THREAD_LOOKUP_BATCH_SIZE)
          .parse(database.prepare(`${threadSelect} WHERE id IN (${placeholders})`).all(...batch));
        for (const row of requiredRows) rowsByThreadId.set(row.threadId.toLowerCase(), row);
      }
    }
    if (rowsByThreadId.size > MAX_THREADS) throw new Error('Codex task metadata exceeds the local index limit');
    const rows = [...rowsByThreadId.values()];
    const threads = rows.map((row): CodexHistorySourceThread => {
      const explicitTitle = normalizedText(row.title || row.name, 500);
      const firstUserMessage = normalizedText(row.firstUserMessage, MAX_METADATA_TEXT_CHARACTERS);
      const preview = normalizedText(row.preview, MAX_METADATA_TEXT_CHARACTERS);
      const title = explicitTitle || firstUserMessage.slice(0, 500) || 'Untitled Codex task';
      const rawWorkspace = normalizedText(row.workspace, 32_768);
      const workspace = normalizedAbsolutePath(rawWorkspace)?.workspace ?? rawWorkspace;
      const branch = normalizedText(row.branch, 1_024);
      const project = resolvedProject(row.projectId, workspace, projects);
      const section = row.sectionId ? sections.byId.get(row.sectionId) : undefined;
      return {
        threadId: row.threadId.toLowerCase(),
        title,
        titleAvailable: Boolean(explicitTitle),
        projectId: project.projectId,
        projectName: project.projectName,
        sectionId: section?.sectionId ?? '',
        sectionName: section?.name ?? '',
        sectionPosition: section ? row.sectionPosition : null,
        pinned: row.pinned === 1,
        workspace,
        branch,
        archived: row.archived === 1,
        source: normalizedThreadSource(row.threadSource, row.sourceDescriptor),
        createdAtMs: row.createdAtMs,
        updatedAtMs: row.updatedAtMs,
        preview,
        metadataText: normalizedText(
          [
            ...new Set(
              [title, firstUserMessage, preview, project.projectName, section?.name, workspace, branch].filter(Boolean),
            ),
          ].join('\n'),
          MAX_METADATA_TEXT_CHARACTERS,
        ),
      };
    });
    return {
      threads,
      projects: projects.projects.map((project) => ({
        projectId: project.projectId,
        name: project.projectName,
        workspace: project.roots[0]?.workspace ?? '',
        position: project.position,
      })),
      sections: sections.sections,
      fullSnapshot,
      sourceThreadCount,
      sourceThreadUpdatedAtMs,
      sourceProjectSignature: organizationSignature,
    };
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

async function readMessages(
  databasePath: string,
  afterRowId: number,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    database.pragma('query_only = ON');
    const columns = tableColumns(database, 'thread_items');
    if (!['thread_id', 'item_id', 'created_at_ms', 'item_json', 'item_type'].every((column) => columns.has(column))) {
      throw new Error('Codex task history database has an unsupported schema');
    }
    const scannedThroughRowId = z
      .object({ rowId: z.number().int().nonnegative().safe() })
      .strict()
      .parse(database.prepare('SELECT COALESCE(MAX(rowid), 0) AS rowId FROM thread_items').get()).rowId;
    const sourceReset = afterRowId > scannedThroughRowId;
    const firstRowId = sourceReset ? 0 : afterRowId;
    const statement = database.prepare(
      `WITH candidates AS MATERIALIZED (
         SELECT rowid AS source_row_id, length(CAST(item_json AS BLOB)) AS item_bytes
         FROM thread_items
         WHERE item_type IN ('userMessage', 'agentMessage')
           AND rowid > ?
           AND rowid <= ?
           AND length(CAST(item_json AS BLOB)) BETWEEN 2 AND ?
         ORDER BY rowid ASC
         LIMIT ?
       ), bounded AS (
         SELECT
           source_row_id,
           SUM(item_bytes) OVER (ORDER BY source_row_id) AS cumulative_bytes
         FROM candidates
       )
       SELECT
         item.rowid AS sourceRowId,
         item.thread_id AS threadId,
         item.item_id AS itemId,
         item.created_at_ms AS createdAtMs,
         item.item_type AS itemType,
         item.item_json AS itemJson
       FROM bounded
       JOIN thread_items AS item ON item.rowid = bounded.source_row_id
       WHERE bounded.cumulative_bytes <= ?
       ORDER BY item.rowid ASC`,
    );
    const messages: CodexHistorySourceMessage[] = [];
    let sourceRowId = firstRowId;
    let inspected = 0;
    while (sourceRowId < scannedThroughRowId) {
      signal.throwIfAborted();
      const rows = z
        .array(indexedMessageRowSchema)
        .max(MESSAGE_PAGE_SIZE)
        .parse(
          statement.all(
            sourceRowId,
            scannedThroughRowId,
            MAX_ITEM_JSON_BYTES,
            MESSAGE_PAGE_SIZE,
            MAX_MESSAGE_PAGE_BYTES,
          ),
        );
      if (!rows.length) break;
      for (const row of rows) {
        sourceRowId = row.sourceRowId;
        const message = parsedMessage(row);
        if (message) messages.push(message);
      }
      inspected += rows.length;
      if (inspected > MAX_MESSAGE_ITEMS) throw new Error('Codex task history exceeds the local index limit');
      const coveredRowIds = sourceRowId - firstRowId;
      const availableRowIds = scannedThroughRowId - firstRowId;
      onProgress(availableRowIds ? Math.min(100, Math.round((coveredRowIds / availableRowIds) * 100)) : 100);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    onProgress(100);
    return { messages, scannedThroughRowId, sourceReset };
  } finally {
    database.close();
  }
}

export async function readCodexHistorySourceSnapshot(
  paths: CodexHistorySourcePaths,
  cursor: CodexHistorySourceCursor,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<CodexHistorySourceSnapshot> {
  signal.throwIfAborted();
  const messageSnapshot = await readMessages(paths.threadHistoryDatabasePath, cursor.historyRowId, signal, (progress) =>
    onProgress(Math.round(progress * 0.65)),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const threadSnapshot = readThreads(
    paths.stateDatabasePath,
    cursor,
    messageSnapshot.messages.map(({ threadId }) => threadId),
    signal,
  );
  onProgress(80);
  const threadIds = new Set(threadSnapshot.threads.map(({ threadId }) => threadId));
  return {
    paths,
    threads: threadSnapshot.threads,
    messages: messageSnapshot.messages.filter(({ threadId }) => threadIds.has(threadId)),
    projects: threadSnapshot.projects,
    sections: threadSnapshot.sections,
    scannedThroughRowId: messageSnapshot.scannedThroughRowId,
    sourceReset: messageSnapshot.sourceReset,
    fullThreadSnapshot: threadSnapshot.fullSnapshot,
    sourceThreadUpdatedAtMs: threadSnapshot.sourceThreadUpdatedAtMs,
    sourceThreadCount: threadSnapshot.sourceThreadCount,
    sourceProjectSignature: threadSnapshot.sourceProjectSignature,
  };
}

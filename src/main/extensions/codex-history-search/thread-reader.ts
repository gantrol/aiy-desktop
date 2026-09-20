import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { normalizeCodexHistoryQuery } from '@/shared/codex-history-search-query';
import { forwardJsonLines, type ForwardScanState } from '@/main/extensions/codex-history-search/forward-json-lines';
import {
  CODEX_HISTORY_PROJECTED_ITEM_TYPES,
  parseProjectedCodexHistoryItem,
  parseProjectedCodexHistoryValue,
} from '@/main/extensions/codex-history-search/message-content';
import {
  codexHistoryProjectedItemBytesSql,
  codexHistoryProjectedItemJsonSql,
  codexHistoryProjectedItemTypePredicate,
} from '@/main/extensions/codex-history-search/projected-item-sql';
import type { CodexHistorySourcePaths } from '@/main/extensions/codex-history-search/source-reader';
import type {
  CodexHistoryMessage,
  CodexHistoryThreadMessagesInput,
  CodexHistoryThreadMessagesPage,
} from '@/shared/contracts/codex-history-search';

const PROJECTED_BATCH_SIZE = 250;
const MAX_PROJECTED_CANDIDATES = 5_000;
const MAX_PROJECTED_ITEM_BYTES = 4 * 1024 * 1024 + 16 * 1024;
const MAX_PROJECTED_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_PROJECTED_PAGE_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_LEGACY_PAGE_BYTES = 64 * 1024 * 1024;
const MAX_LEGACY_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_LEGACY_SOURCE_TEXT_CHARACTERS = 4 * 1024 * 1024;

const tableColumnSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
const threadDescriptorSchema = z
  .object({
    rolloutPath: z.string().min(1).max(32_000),
    historyMode: z.string().trim().max(100),
    createdAtMs: z.number().nonnegative().nullable(),
    modelProvider: z.string().trim().min(1).max(200).nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();
const projectedItemRowSchema = z
  .object({
    rolloutOrdinal: z.number().int().nonnegative().safe(),
    itemId: z.string().min(1).max(512),
    turnId: z.string().min(1).max(512).nullable(),
    createdAtMs: z.number().int().nonnegative().safe(),
    itemType: z.enum(CODEX_HISTORY_PROJECTED_ITEM_TYPES),
    itemJson: z.string().min(2).max(MAX_PROJECTED_ITEM_BYTES),
    itemBytes: z.number().int().min(2).max(MAX_PROJECTED_ITEM_BYTES),
    candidateCount: z.number().int().positive().max(PROJECTED_BATCH_SIZE),
  })
  .strict();
const rolloutEnvelopeSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.string().min(1).max(100),
    payload: z.unknown(),
  })
  .passthrough();
const legacyUserMessageSchema = z
  .object({
    type: z.literal('user_message'),
    message: z.string().max(MAX_LEGACY_SOURCE_TEXT_CHARACTERS),
    client_id: z.string().min(1).max(512).nullable().optional(),
  })
  .passthrough();
const completedItemSchema = z
  .object({
    type: z.literal('item_completed'),
    item: z.object({ type: z.enum(CODEX_HISTORY_PROJECTED_ITEM_TYPES) }).passthrough(),
  })
  .passthrough();
const outputTextPartSchema = z
  .object({
    type: z.literal('output_text'),
    text: z.string().max(MAX_LEGACY_SOURCE_TEXT_CHARACTERS),
  })
  .passthrough();
const assistantResponseSchema = z
  .object({
    type: z.literal('message'),
    id: z.string().min(1).max(512).optional(),
    role: z.literal('assistant'),
    phase: z.string().max(64).nullable().optional(),
    content: z.array(z.unknown()).max(256),
  })
  .passthrough();

interface LocatedMessage {
  message: CodexHistoryMessage;
  searchText: string;
  cursor: number;
  resumeCursor?: number;
}

type ThreadMessagesBody = Omit<CodexHistoryThreadMessagesPage, 'model' | 'modelProvider'>;

function messageMatches(
  message: Pick<CodexHistoryMessage, 'role'>,
  searchText: string,
  input: CodexHistoryThreadMessagesInput,
) {
  return (
    (!input.role || input.role === 'ALL' || input.role === message.role) &&
    (!input.query || normalizeCodexHistoryQuery(searchText).includes(input.query))
  );
}

interface ReverseScanState {
  bytesRead: number;
  continuationCursor: number | null;
  earliestLineStart: number | null;
  exhausted: boolean;
  scanLimited: boolean;
}

function tableColumns(database: Database.Database, table: string) {
  return new Set(
    z
      .array(tableColumnSchema)
      .parse(database.prepare(`PRAGMA table_info(${table})`).all())
      .map(({ name }) => name),
  );
}

export function readThreadDescriptor(databasePath: string, threadId: string) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    database.pragma('query_only = ON');
    const columns = tableColumns(database, 'threads');
    if (!['id', 'rollout_path'].every((column) => columns.has(column))) {
      throw new Error('Codex task metadata database has an unsupported schema');
    }
    const historyMode = columns.has('history_mode') ? 'history_mode' : "'legacy'";
    const createdAt = columns.has('created_at_ms')
      ? columns.has('created_at')
        ? 'COALESCE(created_at_ms, created_at * 1000)'
        : 'created_at_ms'
      : columns.has('created_at')
        ? 'created_at * 1000'
        : 'NULL';
    const optionalText = (column: string, maximumCharacters: number) =>
      columns.has(column) ? `NULLIF(trim(substr(${column}, 1, ${maximumCharacters})), '')` : 'NULL';
    const value = database
      .prepare(
        `SELECT
           substr(rollout_path, 1, 32000) AS rolloutPath,
           ${historyMode} AS historyMode,
           ${createdAt} AS createdAtMs,
           ${optionalText('model_provider', 200)} AS modelProvider,
           ${optionalText('model', 200)} AS model
         FROM threads
         WHERE id = ?
         LIMIT 1`,
      )
      .get(threadId);
    if (!value) throw new Error('Codex task was not found');
    return threadDescriptorSchema.parse(value);
  } finally {
    database.close();
  }
}

function isoTimestamp(epochMs: number) {
  return new Date(epochMs).toISOString();
}

function parsedTimestamp(value: string) {
  const epochMs = Date.parse(value);
  return Number.isFinite(epochMs) && epochMs >= 0 ? new Date(epochMs).toISOString() : null;
}

function locatedParsedMessage(
  parsed: NonNullable<ReturnType<typeof parseProjectedCodexHistoryValue>>,
  messageId: string,
  createdAt: string,
  cursor: number,
): LocatedMessage {
  return {
    cursor,
    searchText: parsed.searchText,
    message: {
      messageId,
      role: parsed.role,
      turnId: null,
      phase: parsed.phase,
      createdAt,
      text: parsed.text,
      blocks: parsed.blocks,
    },
  };
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.toNamespacedPath(root), path.toNamespacedPath(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function hasForbiddenSegment(candidate: string) {
  return path
    .resolve(candidate)
    .split(path.sep)
    .some((segment) => segment.toLocaleLowerCase().includes('trash'));
}

export async function safeRolloutPath(codexHome: string, rolloutPath: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!path.isAbsolute(rolloutPath)) throw new Error('Codex task history path is invalid');
  const candidate = path.resolve(rolloutPath);
  if (hasForbiddenSegment(candidate)) throw new Error('Codex task history path is unavailable');
  const lexicalRoots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  const lexicalRoot = lexicalRoots.find((root) => isWithin(root, candidate));
  if (!lexicalRoot) throw new Error('Codex task history path is outside the Codex data directory');
  const [rootPath, metadata, filePath] = await Promise.all([
    realpath(lexicalRoot),
    lstat(candidate),
    realpath(candidate),
  ]);
  signal.throwIfAborted();
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Codex task history file is invalid');
  if (!isWithin(rootPath, filePath) || hasForbiddenSegment(filePath)) {
    throw new Error('Codex task history path is outside the Codex data directory');
  }
  return filePath;
}

async function readProjectedMessages(
  databasePath: string,
  input: CodexHistoryThreadMessagesInput,
  signal: AbortSignal,
): Promise<ThreadMessagesBody> {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    database.pragma('query_only = ON');
    const columns = tableColumns(database, 'thread_items');
    if (
      !['thread_id', 'item_id', 'rollout_ordinal', 'created_at_ms', 'item_json', 'item_type'].every((column) =>
        columns.has(column),
      )
    ) {
      signal.throwIfAborted();
      throw new Error('Codex task history database has an unsupported schema');
    }
    const newer = input.direction === 'NEWER';
    const order = newer ? 'ASC' : 'DESC';
    const projectedJson = codexHistoryProjectedItemJsonSql('item');
    const projectedBytes = codexHistoryProjectedItemBytesSql('item');
    const turnId = columns.has('turn_id') ? 'item.turn_id' : 'NULL';
    const statement = database.prepare(
      `WITH candidates AS MATERIALIZED (
         SELECT
           item.rollout_ordinal AS rolloutOrdinal,
           item.item_id AS itemId,
           ${turnId} AS turnId,
           item.created_at_ms AS createdAtMs,
           item.item_type AS itemType,
           ${projectedJson} AS itemJson,
           ${projectedBytes} AS itemBytes
         FROM thread_items AS item
         WHERE item.thread_id = ?
           AND ${codexHistoryProjectedItemTypePredicate('item')}
           AND item.rollout_ordinal ${newer ? '>=' : '<'} ?
           AND ${projectedBytes} BETWEEN 2 AND ?
         ORDER BY item.rollout_ordinal ${order}, item.created_at_ms ${order}, item.item_id ${order}
         LIMIT ?
       ), bounded AS (
         SELECT
           *,
           SUM(itemBytes) OVER (ORDER BY rolloutOrdinal ${order}, createdAtMs ${order}, itemId ${order}) AS cumulativeBytes,
           COUNT(*) OVER () AS candidateCount
         FROM candidates
       )
       SELECT rolloutOrdinal, itemId, turnId, createdAtMs, itemType, itemJson, itemBytes, candidateCount
       FROM bounded
       WHERE cumulativeBytes <= ?
       ORDER BY rolloutOrdinal ${order}, createdAtMs ${order}, itemId ${order}`,
    );
    const located: LocatedMessage[] = [];
    let cursor = input.cursor ?? (newer ? 0 : Number.MAX_SAFE_INTEGER);
    let inspected = 0;
    let inspectedBytes = 0;
    let exhausted = false;
    while (
      located.length <= input.pageSize &&
      !exhausted &&
      inspected < MAX_PROJECTED_CANDIDATES &&
      inspectedBytes <= MAX_PROJECTED_PAGE_BYTES - MAX_PROJECTED_ITEM_BYTES
    ) {
      signal.throwIfAborted();
      const batchSize = Math.min(PROJECTED_BATCH_SIZE, MAX_PROJECTED_CANDIDATES - inspected);
      const rows = z
        .array(projectedItemRowSchema)
        .max(batchSize)
        .parse(
          statement.all(
            input.threadId,
            cursor,
            MAX_PROJECTED_ITEM_BYTES,
            batchSize,
            Math.min(MAX_PROJECTED_BATCH_BYTES, MAX_PROJECTED_PAGE_BYTES - inspectedBytes),
          ),
        );
      if (!rows.length) {
        exhausted = true;
        break;
      }
      inspected += rows.length;
      inspectedBytes += rows.reduce((total, row) => total + row.itemBytes, 0);
      cursor = rows.at(-1)!.rolloutOrdinal + (newer ? 1 : 0);
      for (const row of rows) {
        const parsed = parseProjectedCodexHistoryItem(row.itemType, row.itemJson, true);
        if (!parsed || !messageMatches(parsed, parsed.searchText, input)) continue;
        located.push({
          cursor: row.rolloutOrdinal + (newer ? 1 : 0),
          searchText: parsed.searchText,
          message: {
            messageId: row.itemId,
            role: parsed.role,
            turnId: row.turnId,
            phase: parsed.phase,
            createdAt: isoTimestamp(row.createdAtMs),
            text: parsed.text,
            blocks: parsed.blocks,
            position: { before: row.rolloutOrdinal, after: row.rolloutOrdinal + 1 },
          },
        });
        if (located.length > input.pageSize) break;
      }
      if (located.length > input.pageSize) break;
      if (rows.length === rows[0]!.candidateCount && rows[0]!.candidateCount < batchSize) exhausted = true;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const page = located.slice(0, input.pageSize);
    const scanLimited =
      (inspected >= MAX_PROJECTED_CANDIDATES || inspectedBytes > MAX_PROJECTED_PAGE_BYTES - MAX_PROJECTED_ITEM_BYTES) &&
      located.length <= input.pageSize &&
      !exhausted;
    const nextCursor = located.length > input.pageSize ? page.at(-1)!.cursor : exhausted ? null : cursor;
    return {
      threadId: input.threadId,
      source: 'PAGINATED',
      messages: (newer ? page : page.reverse()).map(({ message }) => message),
      nextCursor,
      scanLimited,
    };
  } finally {
    database.close();
  }
}

async function* reverseJsonLines(
  filePath: string,
  endExclusive: number | null,
  state: ReverseScanState,
  signal: AbortSignal,
): AsyncGenerator<{ line: Buffer; start: number }> {
  const handle = await open(filePath, 'r');
  try {
    const file = await handle.stat({ bigint: true });
    if (file.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Codex task history file is too large');
    const fileSize = Number(file.size);
    let position = Math.min(endExclusive ?? fileSize, fileSize);
    let carry = Buffer.alloc(0);
    let discardingOversizedRecord = false;
    while (position > 0 && state.bytesRead < MAX_LEGACY_PAGE_BYTES) {
      signal.throwIfAborted();
      const requested = Math.min(READ_CHUNK_BYTES, position, MAX_LEGACY_PAGE_BYTES - state.bytesRead);
      position -= requested;
      state.continuationCursor = position;
      const buffer = Buffer.allocUnsafe(requested);
      const { bytesRead } = await handle.read(buffer, 0, requested, position);
      if (!bytesRead) break;
      state.bytesRead += bytesRead;
      let chunk = buffer.subarray(0, bytesRead);
      if (discardingOversizedRecord) {
        const boundary = chunk.lastIndexOf(0x0a);
        if (boundary < 0) continue;
        chunk = chunk.subarray(0, boundary);
        discardingOversizedRecord = false;
        state.scanLimited = true;
      }
      const combined = carry.length ? Buffer.concat([chunk, carry]) : chunk;
      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        let line = combined.subarray(index + 1, lineEnd);
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        const start = position + index + 1;
        state.earliestLineStart = start;
        if (line.length > MAX_LEGACY_RECORD_BYTES) state.scanLimited = true;
        else if (line.length) yield { line, start };
        lineEnd = index;
      }
      carry = Buffer.from(combined.subarray(0, lineEnd));
      if (carry.length > MAX_LEGACY_RECORD_BYTES) {
        carry = Buffer.alloc(0);
        discardingOversizedRecord = true;
        state.scanLimited = true;
      }
    }
    if (position === 0) {
      state.exhausted = true;
      if (!discardingOversizedRecord && carry.length) {
        state.earliestLineStart = 0;
        yield { line: carry, start: 0 };
      }
    } else {
      state.scanLimited = true;
    }
  } finally {
    await handle.close();
  }
}

function parseLegacyMessage(line: Buffer, lineStart: number): LocatedMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  const envelope = rolloutEnvelopeSchema.safeParse(value);
  if (!envelope.success) return null;
  const createdAt = parsedTimestamp(envelope.data.timestamp);
  if (!createdAt) return null;
  if (envelope.data.type === 'event_msg') {
    const legacyUser = legacyUserMessageSchema.safeParse(envelope.data.payload);
    if (legacyUser.success) {
      const parsed = parseProjectedCodexHistoryValue(
        'userMessage',
        {
          type: 'userMessage',
          id: legacyUser.data.client_id ?? undefined,
          content: [{ type: 'text', text: legacyUser.data.message }],
        },
        true,
      );
      return parsed
        ? locatedParsedMessage(parsed, parsed.messageId ?? `legacy-user-${lineStart}`, createdAt, lineStart)
        : null;
    }
    const completed = completedItemSchema.safeParse(envelope.data.payload);
    if (!completed.success) return null;
    const parsed = parseProjectedCodexHistoryValue(completed.data.item.type, completed.data.item, true);
    if (!parsed) return null;
    return locatedParsedMessage(parsed, parsed.messageId ?? `completed-${lineStart}`, createdAt, lineStart);
  }
  if (envelope.data.type !== 'response_item') return null;
  const response = assistantResponseSchema.safeParse(envelope.data.payload);
  if (!response.success) return null;
  const text = response.data.content
    .flatMap((part) => {
      const parsed = outputTextPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join('\n');
  const parsed = parseProjectedCodexHistoryValue(
    'agentMessage',
    { type: 'agentMessage', id: response.data.id, phase: response.data.phase, text },
    true,
  );
  return parsed
    ? locatedParsedMessage(parsed, parsed.messageId ?? `assistant-${lineStart}`, createdAt, lineStart)
    : null;
}

async function readLegacyMessages(
  codexHome: string,
  rolloutPath: string,
  input: CodexHistoryThreadMessagesInput,
  signal: AbortSignal,
): Promise<ThreadMessagesBody> {
  const filePath = await safeRolloutPath(codexHome, rolloutPath, signal);
  const state: ReverseScanState = {
    bytesRead: 0,
    continuationCursor: input.cursor,
    earliestLineStart: null,
    exhausted: false,
    scanLimited: false,
  };
  const located: LocatedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const newer = input.direction === 'NEWER';
  const forwardState: ForwardScanState = {
    exhausted: false,
    scanLimited: false,
    continuationCursor: input.cursor ?? 0,
  };
  const lines = newer
    ? forwardJsonLines(filePath, input.cursor ?? 0, forwardState, signal)
    : reverseJsonLines(filePath, input.cursor, state, signal);
  for await (const candidate of lines) {
    const parsed = parseLegacyMessage(candidate.line, candidate.start);
    if (!parsed || seenMessageIds.has(parsed.message.messageId)) continue;
    seenMessageIds.add(parsed.message.messageId);
    if (!messageMatches(parsed.message, parsed.searchText, input)) continue;
    parsed.message.position = { before: candidate.start, after: candidate.start + candidate.line.length };
    located.push({ ...parsed, resumeCursor: candidate.start + candidate.line.length });
    if (located.length > input.pageSize) break;
  }
  const page = located.slice(0, input.pageSize);
  const nextCursor =
    located.length > input.pageSize
      ? newer
        ? page.at(-1)!.resumeCursor!
        : located[input.pageSize]!.resumeCursor!
      : (newer ? forwardState.exhausted : state.exhausted)
        ? null
        : newer
          ? forwardState.continuationCursor
          : (state.earliestLineStart ?? state.continuationCursor);
  return {
    threadId: input.threadId,
    source: 'LEGACY',
    messages: (newer ? page : page.reverse()).map(({ message }) => message),
    nextCursor,
    scanLimited: newer ? forwardState.scanLimited : state.scanLimited,
  };
}

export async function readCodexHistoryThreadMessages(
  paths: CodexHistorySourcePaths,
  codexHome: string,
  input: CodexHistoryThreadMessagesInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const descriptor = readThreadDescriptor(paths.stateDatabasePath, input.threadId);
  const read = (request: CodexHistoryThreadMessagesInput) =>
    descriptor.historyMode.toLocaleLowerCase() === 'paginated'
      ? readProjectedMessages(paths.threadHistoryDatabasePath, request, signal)
      : readLegacyMessages(codexHome, descriptor.rolloutPath, request, signal);
  let page: ThreadMessagesBody;
  if (input.anchor) {
    const context = {
      ...input,
      anchor: undefined,
      query: '',
      role: 'ALL' as const,
      pageSize: Math.floor(input.pageSize / 2),
    };
    const older = await read({ ...context, cursor: input.anchor.after, direction: 'OLDER' });
    signal.throwIfAborted();
    const newer = await read({ ...context, cursor: input.anchor.after, direction: 'NEWER' });
    const known = new Set(older.messages.map(({ messageId }) => messageId));
    page = {
      ...older,
      messages: [...older.messages, ...newer.messages.filter(({ messageId }) => !known.has(messageId))],
      newerCursor: newer.nextCursor,
      scanLimited: older.scanLimited || newer.scanLimited,
    };
  } else {
    page = await read({ ...input, query: normalizeCodexHistoryQuery(input.query ?? '') });
  }
  signal.throwIfAborted();
  return { ...page, modelProvider: descriptor.modelProvider, model: descriptor.model };
}

import { ulid } from 'ulid';
import { z } from 'zod';
import type {
  CodexAssistResult,
  CreatorAgentChatInput,
  CreatorAgentHistoryInput,
  CreatorAgentHistoryPageDto,
  CreatorAgentScope,
  CreatorAgentTurnDto,
} from '@/shared/contracts';
import {
  CreatorAgentPersistenceError,
  decodeCreatorAgentRequest,
  decodeCreatorAgentResult,
  encodeCreatorAgentRequest,
  encodeCreatorAgentResult,
  MAX_CREATOR_AGENT_PAGE_BYTES,
  MAX_CREATOR_AGENT_REQUEST_BYTES,
  MAX_CREATOR_AGENT_RESULT_BYTES,
  type StoredCreatorAgentRequest,
} from '@/main/database/assistant/creator-agent-persistence';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';

interface CreatorAgentCursor {
  createdAt: string;
  id: string;
}

interface ParsedTurnRow {
  row: z.infer<typeof turnRowSchema>;
  request: StoredCreatorAgentRequest;
  attachmentAssetIds: string[];
}

interface TurnSelection {
  rows: Array<z.infer<typeof turnRowSchema>>;
  hasMore: boolean;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const ASSET_QUERY_BATCH_SIZE = 500;

const idSchema = z.string().min(1).max(200);
const timestampSchema = z.string().min(1).max(100);
const turnCandidateRowSchema = z.object({
  id: idSchema,
  created_at: timestampSchema,
  request_bytes: z.number().int().nonnegative(),
  result_bytes: z.number().int().nonnegative(),
  request_valid: z.union([z.literal(0), z.literal(1)]).nullable(),
  result_valid: z.union([z.literal(0), z.literal(1)]).nullable(),
});
const turnRowSchema = z.object({
  id: idSchema,
  scope_kind: z.enum(['DRAFT', 'SERIES']),
  scope_id: idSchema,
  request_json: z.string(),
  result_json: z.string(),
  created_at: timestampSchema,
});
const assetRowSchema = z.object({
  id: idSchema,
  kind: z.enum(['GENERATED', 'REFERENCE']),
  origin_type: z.string().max(120),
  width: z.number().int().nonnegative().max(65_535),
  height: z.number().int().nonnegative().max(65_535),
  mime_type: z.string().min(1).max(200),
  byte_size: z.number().int().nonnegative(),
  created_at: timestampSchema,
});

function parseTurnRow(row: z.infer<typeof turnRowSchema>): ParsedTurnRow {
  const request = decodeCreatorAgentRequest(row.request_json, row.id);
  return { row, request, attachmentAssetIds: [...new Set(request.attachmentAssetIds)] };
}

function loadAssets(rows: ParsedTurnRow[], db: LibraryStorage['db']) {
  const ids = [...new Set(rows.flatMap((row) => row.attachmentAssetIds))];
  const assets = new Map<string, CreatorAgentTurnDto['attachments'][number]>();
  for (let offset = 0; offset < ids.length; offset += ASSET_QUERY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ASSET_QUERY_BATCH_SIZE);
    const assetRows = db
      .prepare(
        `SELECT id, kind, origin_type, width, height, mime_type, byte_size, created_at FROM image_assets
        WHERE id IN (${batch.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
      )
      .all(...batch) as JsonMap[];
    for (const rawAsset of assetRows) {
      const asset = assetRowSchema.parse(rawAsset);
      const assetId = asset.id;
      assets.set(assetId, {
        id: assetId,
        kind: asset.kind,
        originType: asset.origin_type,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mime_type,
        byteSize: asset.byte_size,
        mediaUrl: mediaUrl(assetId),
        createdAt: asset.created_at,
      });
    }
  }
  return assets;
}

function toTurn(
  parsed: ParsedTurnRow,
  assets: Map<string, CreatorAgentTurnDto['attachments'][number]>,
): CreatorAgentTurnDto {
  const { row, request, attachmentAssetIds } = parsed;
  return {
    id: text(row.id),
    scope: { kind: row.scope_kind, id: row.scope_id },
    mode: request.mode,
    prompt: request.prompt,
    message: request.message,
    attachments: attachmentAssetIds.flatMap((assetId) => {
      const asset = assets.get(assetId);
      return asset ? [asset] : [];
    }),
    result: decodeCreatorAgentResult(row.result_json, row.id),
    createdAt: row.created_at,
  };
}

function hydrateTurns(rows: Array<z.infer<typeof turnRowSchema>>, db: LibraryStorage['db']) {
  const parsedRows = rows.map(parseTurnRow);
  const assets = loadAssets(parsedRows, db);
  return parsedRows.map((row) => toTurn(row, assets));
}

function encodeCursor(cursor: CreatorAgentCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): CreatorAgentCursor | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid cursor');
    const cursor = decoded as JsonMap;
    const createdAt = text(cursor.createdAt);
    const id = text(cursor.id);
    if (!createdAt || createdAt.length > 100 || !id || id.length > 200) throw new Error('Invalid cursor');
    return { createdAt, id };
  } catch {
    throw new Error('Invalid creator agent history cursor');
  }
}

function boundedLimit(value: number, fallback = DEFAULT_HISTORY_LIMIT) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, MAX_HISTORY_LIMIT)) : fallback;
}

export class CreatorAgentRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  private selectRows(scope: CreatorAgentScope, cursor: CreatorAgentCursor | null, limit: number): TurnSelection {
    const cursorClause = cursor ? 'AND (created_at, id) < (?, ?)' : '';
    const cursorParameters = cursor ? [cursor.createdAt, cursor.id] : [];
    const candidates = (
      this.db
        .prepare(
          `SELECT id, created_at,
            length(CAST(request_json AS BLOB)) AS request_bytes,
            length(CAST(result_json AS BLOB)) AS result_bytes,
            CASE WHEN length(CAST(request_json AS BLOB)) <= ?
              THEN json_valid(request_json) ELSE NULL END AS request_valid,
            CASE WHEN length(CAST(result_json AS BLOB)) <= ?
              THEN json_valid(result_json) ELSE NULL END AS result_valid
          FROM creator_agent_turns
          WHERE scope_kind = ? AND scope_id = ? ${cursorClause}
          ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(
          MAX_CREATOR_AGENT_REQUEST_BYTES,
          MAX_CREATOR_AGENT_RESULT_BYTES,
          scope.kind,
          scope.id,
          ...cursorParameters,
          limit + 1,
        ) as JsonMap[]
    ).map((row) => turnCandidateRowSchema.parse(row));

    const selected: typeof candidates = [];
    let selectedBytes = 0;
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      if (candidate.request_bytes > MAX_CREATOR_AGENT_REQUEST_BYTES) {
        throw new CreatorAgentPersistenceError(candidate.id, 'OVERSIZED_REQUEST');
      }
      if (candidate.result_bytes > MAX_CREATOR_AGENT_RESULT_BYTES) {
        throw new CreatorAgentPersistenceError(candidate.id, 'OVERSIZED_RESULT');
      }
      if (candidate.request_valid !== 1) {
        throw new CreatorAgentPersistenceError(candidate.id, 'MALFORMED_REQUEST');
      }
      if (candidate.result_valid !== 1) {
        throw new CreatorAgentPersistenceError(candidate.id, 'MALFORMED_RESULT');
      }
      const nextBytes = selectedBytes + candidate.request_bytes + candidate.result_bytes;
      if (nextBytes > MAX_CREATOR_AGENT_PAGE_BYTES) break;
      selected.push(candidate);
      selectedBytes = nextBytes;
    }

    if (selected.length === 0) return { rows: [], hasMore: candidates.length > 0 };
    const ids = selected.map((row) => row.id);
    const rawRows = this.db
      .prepare(
        `SELECT id, scope_kind, scope_id, request_json, result_json, created_at
        FROM creator_agent_turns WHERE id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids) as JsonMap[];
    const rowsById = new Map(
      rawRows.map((row) => {
        const parsed = turnRowSchema.parse(row);
        return [parsed.id, parsed] as const;
      }),
    );
    const rows = ids.map((id) => {
      const row = rowsById.get(id);
      if (!row) throw new CreatorAgentPersistenceError(id, 'MALFORMED_REQUEST');
      return row;
    });
    return { rows, hasMore: candidates.length > selected.length };
  }

  page(input: CreatorAgentHistoryInput): CreatorAgentHistoryPageDto {
    const cursor = decodeCursor(input.cursor);
    const limit = boundedLimit(input.limit);
    return this.db.transaction(() => {
      const selection = this.selectRows(input.scope, cursor, limit);
      const oldest = selection.rows.at(-1);
      return {
        items: hydrateTurns([...selection.rows].reverse(), this.db),
        nextCursor: selection.hasMore && oldest ? encodeCursor({ createdAt: oldest.created_at, id: oldest.id }) : null,
      };
    })();
  }

  recentChat(scope: CreatorAgentScope, requestedLimit = 20): CreatorAgentTurnDto[] {
    const limit = boundedLimit(requestedLimit, 20);
    return this.db.transaction(() => {
      const selection = this.selectRows(scope, null, limit);
      return hydrateTurns([...selection.rows].reverse(), this.db);
    })();
  }

  /** @deprecated Use page() for UI history and recentChat() for model context. */
  list(scope: CreatorAgentScope): CreatorAgentTurnDto[] {
    return this.page({ scope, cursor: null, limit: MAX_HISTORY_LIMIT }).items;
  }

  add(scope: CreatorAgentScope, input: CreatorAgentChatInput, result: CodexAssistResult): CreatorAgentTurnDto {
    return this.db.transaction(() => {
      const target =
        scope.kind === 'DRAFT'
          ? this.db
              .prepare(
                `SELECT id FROM creation_drafts
          WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
              )
              .get(scope.id)
          : this.db.prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(scope.id);
      if (!target) throw new Error('Agent conversation target is no longer available');
      const id = ulid();
      const createdAt = now();
      const requestJson = encodeCreatorAgentRequest(input, id);
      const resultJson = encodeCreatorAgentResult(result, id);
      this.db
        .prepare(
          `INSERT INTO creator_agent_turns
        (id, scope_kind, scope_id, request_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, scope.kind, scope.id, requestJson, resultJson, createdAt);
      this.storage.recordChange('CREATOR_AGENT_TURN', id, 'CREATE', { scope });
      const row = turnRowSchema.parse(
        this.db
          .prepare(
            `SELECT id, scope_kind, scope_id, request_json, result_json, created_at
            FROM creator_agent_turns WHERE id = ?`,
          )
          .get(id),
      );
      return hydrateTurns([row], this.db)[0];
    })();
  }
}

import { ulid } from 'ulid';
import type {
  CodexAssistResult,
  CreatorAgentChatInput,
  CreatorAgentScope,
  CreatorAgentTurnDto,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/values';

function parseJson(value: unknown): JsonMap {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function parseResult(value: unknown): CodexAssistResult {
  const result = parseJson(value);
  const directions = Array.isArray(result.directions) ? result.directions : [];
  const promptEdit = result.promptEdit && typeof result.promptEdit === 'object' ? (result.promptEdit as JsonMap) : {};
  const revisedUserInstruction = text(promptEdit.revisedUserInstruction) || text(result.optimizedPrompt);
  return {
    assistantMessage: text(result.assistantMessage),
    optimizedPrompt: revisedUserInstruction,
    promptEdit: {
      summary: text(promptEdit.summary),
      preserved: Array.isArray(promptEdit.preserved) ? promptEdit.preserved.map(text) : [],
      changes: Array.isArray(promptEdit.changes)
        ? promptEdit.changes.flatMap((change) => {
            if (!change || typeof change !== 'object') return [];
            const item = change as JsonMap;
            return [{ before: text(item.before), after: text(item.after), reason: text(item.reason) }];
          })
        : [],
      removed: Array.isArray(promptEdit.removed) ? promptEdit.removed.map(text) : [],
      revisedUserInstruction,
    },
    sharedConstraints: Array.isArray(result.sharedConstraints) ? result.sharedConstraints.map(text) : [],
    assumptions: Array.isArray(result.assumptions)
      ? result.assumptions.flatMap((assumption) => {
          if (!assumption || typeof assumption !== 'object') return [];
          const item = assumption as JsonMap;
          return [{ label: text(item.label), interpretation: text(item.interpretation), impact: text(item.impact) }];
        })
      : [],
    directions: directions.flatMap((direction) => {
      if (!direction || typeof direction !== 'object') return [];
      const item = direction as JsonMap;
      return [
        {
          label: text(item.label),
          prompt: text(item.prompt),
          rationale: text(item.rationale),
          variableAxis: text(item.variableAxis),
          risk: text(item.risk),
        },
      ];
    }),
  };
}

function toTurn(row: JsonMap, db: LibraryStorage['db']): CreatorAgentTurnDto {
  const request = parseJson(row.request_json);
  const attachmentAssetIds = Array.isArray(request.attachmentAssetIds)
    ? [...new Set(request.attachmentAssetIds.map(text).filter(Boolean))]
    : [];
  const attachments = attachmentAssetIds.flatMap((assetId) => {
    const asset = db
      .prepare(
        `SELECT * FROM image_assets
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(assetId) as JsonMap | undefined;
    return asset
      ? [
          {
            id: assetId,
            kind: text(asset.kind) as CreatorAgentTurnDto['attachments'][number]['kind'],
            originType: text(asset.origin_type),
            width: Number(asset.width),
            height: Number(asset.height),
            mimeType: text(asset.mime_type),
            byteSize: Number(asset.byte_size),
            mediaUrl: mediaUrl(assetId),
            createdAt: text(asset.created_at),
          },
        ]
      : [];
  });
  return {
    id: text(row.id),
    scope: { kind: text(row.scope_kind) as CreatorAgentScope['kind'], id: text(row.scope_id) },
    mode: text(request.mode) as CreatorAgentTurnDto['mode'],
    prompt: text(request.prompt),
    message: text(request.message),
    attachments,
    result: parseResult(row.result_json),
    createdAt: text(row.created_at),
  };
}

export class CreatorAgentRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  list(scope: CreatorAgentScope): CreatorAgentTurnDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM creator_agent_turns
      WHERE scope_kind = ? AND scope_id = ? ORDER BY created_at, id`,
      )
      .all(scope.kind, scope.id) as JsonMap[];
    return rows.map((row) => toTurn(row, this.db));
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
      this.db
        .prepare(
          `INSERT INTO creator_agent_turns
        (id, scope_kind, scope_id, request_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, scope.kind, scope.id, JSON.stringify(input), JSON.stringify(result), createdAt);
      this.storage.recordChange('CREATOR_AGENT_TURN', id, 'CREATE', { scope });
      return toTurn(this.db.prepare('SELECT * FROM creator_agent_turns WHERE id = ?').get(id) as JsonMap, this.db);
    })();
  }
}

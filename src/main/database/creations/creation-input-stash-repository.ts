import { ulid } from 'ulid';
import type {
  AssetDto,
  CreationInputSnapshotDto,
  CreationInputSnapshotInput,
  CreationInputStashCreateInput,
  CreationInputStashDto,
  CreatorAgentScope,
} from '@/shared/contracts';
import { canonicalSnapshotJson, snapshotContentHash } from '@/main/database/generation/snapshot-content';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';

function assetDto(row: JsonMap): AssetDto {
  const id = text(row.id);
  return {
    id,
    kind: text(row.kind) as AssetDto['kind'],
    originType: text(row.origin_type),
    width: Number(row.width),
    height: Number(row.height),
    mimeType: text(row.mime_type),
    byteSize: Number(row.byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.created_at),
  };
}

function snapshotFromJson(value: unknown): CreationInputSnapshotInput {
  if (typeof value !== 'string') throw new Error('Stored creation input stash is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored creation input stash is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error('Unsupported creation input stash schema');
  }
  return parsed as CreationInputSnapshotInput;
}

function normalizedSnapshot(input: CreationInputSnapshotInput): CreationInputSnapshotInput {
  const title = input.title.trim();
  return {
    schemaVersion: 1,
    title: title,
    manualPrompt: input.manualPrompt,
    ...(input.promptNodes ? { promptNodes: input.promptNodes.map((node) => ({ ...node })) } : {}),
    resolvedPrompt: input.resolvedPrompt,
    referenceAssetIds: [...input.referenceAssetIds],
    termPromptLocale: input.termPromptLocale,
    termIds: [...input.termIds],
    wordPaletteReferences: input.wordPaletteReferences.map((reference) => ({
      paletteId: reference.paletteId,
      paletteRevisionId: reference.paletteRevisionId,
      parameterValues: { ...reference.parameterValues },
      promptLocale: reference.promptLocale,
    })),
    dictionaryScope: {
      mode: input.dictionaryScope.mode,
      sources: input.dictionaryScope.sources.map((source) => ({ ...source })),
      includeLocalTerms: input.dictionaryScope.includeLocalTerms,
    },
    canvasPresetKey: input.canvasPresetKey,
    generationTargets: input.generationTargets.map((target) => ({ ...target })),
  };
}

export function rehomeCreationInputStashes(storage: LibraryStorage, draftId: string, seriesId: string) {
  const rows = storage.db
    .prepare(
      `SELECT id, revision_no FROM creation_input_stashes
    WHERE scope_kind = 'DRAFT' AND scope_id = ?
    ORDER BY revision_no, id`,
    )
    .all(draftId) as JsonMap[];
  if (!rows.length) return;
  const targetMax = Number(
    (
      storage.db
        .prepare(
          `SELECT COALESCE(MAX(revision_no), 0) AS revision_no
    FROM creation_input_stashes WHERE scope_kind = 'SERIES' AND scope_id = ?`,
        )
        .get(seriesId) as JsonMap
    ).revision_no,
  );
  const update = storage.db.prepare(`UPDATE creation_input_stashes
    SET scope_kind = 'SERIES', scope_id = ?, revision_no = ? WHERE id = ?`);
  rows.forEach((row, index) => {
    const stashId = text(row.id);
    const revisionNo = targetMax + index + 1;
    update.run(seriesId, revisionNo, stashId);
    storage.recordChange('CREATION_INPUT_STASH', stashId, 'REHOME_SCOPE', {
      from: { kind: 'DRAFT', id: draftId },
      to: { kind: 'SERIES', id: seriesId },
      revisionNo,
    });
  });
}

export class CreationInputStashRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  list(scope: CreatorAgentScope): CreationInputStashDto[] {
    this.assertScopeAvailable(scope);
    const rows = this.db
      .prepare(
        `SELECT * FROM creation_input_stashes
      WHERE scope_kind = ? AND scope_id = ?
      ORDER BY revision_no DESC, id DESC LIMIT 100`,
      )
      .all(scope.kind, scope.id) as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  create(input: CreationInputStashCreateInput): CreationInputStashDto {
    return this.db.transaction(() => {
      this.assertScopeAvailable(input.scope);
      const snapshot = normalizedSnapshot(input.snapshot);
      this.assertReferencesAvailable(snapshot.referenceAssetIds);
      const revisionNo = Number(
        (
          this.db
            .prepare(
              `SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no
        FROM creation_input_stashes WHERE scope_kind = ? AND scope_id = ?`,
            )
            .get(input.scope.kind, input.scope.id) as JsonMap
        ).revision_no,
      );
      const id = ulid();
      const createdAt = now();
      const contentHash = snapshotContentHash(snapshot);
      this.db
        .prepare(
          `INSERT INTO creation_input_stashes
        (id, scope_kind, scope_id, revision_no, input_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.scope.kind, input.scope.id, revisionNo, canonicalSnapshotJson(snapshot), contentHash, createdAt);
      this.storage.recordChange('CREATION_INPUT_STASH', id, 'CREATE', {
        scope: input.scope,
        revisionNo,
        contentHash,
      });
      return this.dto(this.db.prepare('SELECT * FROM creation_input_stashes WHERE id = ?').get(id) as JsonMap);
    })();
  }

  private assertScopeAvailable(scope: CreatorAgentScope) {
    const found =
      scope.kind === 'DRAFT'
        ? this.db
            .prepare(
              `SELECT 1 FROM creation_drafts
          WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
            )
            .get(scope.id)
        : this.db
            .prepare(
              `SELECT 1 FROM prompt_series
          WHERE id = ? AND deleted_at IS NULL`,
            )
            .get(scope.id);
    if (!found)
      throw new Error(scope.kind === 'DRAFT' ? 'Creation draft is no longer available' : 'Creation not found');
  }

  private assertReferencesAvailable(referenceAssetIds: readonly string[]) {
    if (!referenceAssetIds.length) return;
    const uniqueIds = [...new Set(referenceAssetIds)];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const count = Number(
      (
        this.db
          .prepare(
            `SELECT count(*) AS count FROM image_assets
      WHERE deleted_at IS NULL AND id IN (${placeholders})`,
          )
          .get(...uniqueIds) as JsonMap
      ).count,
    );
    if (count !== uniqueIds.length) throw new Error('A reference image is no longer available');
  }

  private dto(row: JsonMap): CreationInputStashDto {
    const stored = normalizedSnapshot(snapshotFromJson(row.input_json));
    const assets = this.referenceAssets(stored.referenceAssetIds);
    const snapshot: CreationInputSnapshotDto = { ...stored, referenceAssets: assets };
    return {
      id: text(row.id),
      scope: {
        kind: text(row.scope_kind) as CreatorAgentScope['kind'],
        id: text(row.scope_id),
      },
      revisionNo: Number(row.revision_no),
      snapshot,
      contentHash: text(row.content_hash),
      createdAt: text(row.created_at),
    };
  }

  private referenceAssets(ids: readonly string[]): AssetDto[] {
    if (!ids.length) return [];
    const uniqueIds = [...new Set(ids)];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets
      WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      )
      .all(...uniqueIds) as JsonMap[];
    const byId = new Map(rows.map((row) => [text(row.id), assetDto(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}

import { ulid } from 'ulid';
import type { AssetDto } from '@/shared/contracts';
import {
  imageBreakdownCreateInputSchema,
  imageBreakdownResultSchema,
  imageBreakdownSchema,
  imageBreakdownRouteKeySchema,
  type ImageBreakdownCreateInput,
  type ImageBreakdownDto,
  type ImageBreakdownResult,
  type ImageBreakdownRouteKey,
} from '@/shared/contracts/image-breakdown';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

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

function parsedResult(value: unknown): ImageBreakdownResult | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Stored image breakdown result is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored image breakdown result is invalid');
  }
  return imageBreakdownResultSchema.parse(parsed);
}

export class ImageBreakdownRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  list(): ImageBreakdownDto[] {
    const rows = this.db
      .prepare(
        `SELECT breakdown.*, asset.id AS asset_id, asset.kind AS asset_kind,
          asset.origin_type AS asset_origin_type, asset.width AS asset_width,
          asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM image_breakdowns breakdown
        JOIN image_assets asset ON asset.id = breakdown.source_asset_id AND asset.deleted_at IS NULL
        WHERE breakdown.archived_at IS NULL AND breakdown.deleted_at IS NULL
        ORDER BY breakdown.updated_at DESC, breakdown.id DESC`,
      )
      .all() as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  get(id: string): ImageBreakdownDto {
    return this.dto(this.row(id));
  }

  create(input: ImageBreakdownCreateInput) {
    const parsed = imageBreakdownCreateInputSchema.parse(input);
    return this.db
      .transaction(() => {
        this.assetRow(parsed.sourceAssetId);
        const creationItems = new CreationItemRepository(this.storage);
        const sourceForm = creationItems.findSourceFormForImageAsset(parsed.sourceAssetId, parsed.sourceFormId);
        if (parsed.sourceFormId && !sourceForm) {
          throw new Error('The selected image does not belong to the source creation form');
        }
        if (sourceForm) {
          const existingForm = creationItems.findForm(sourceForm.creationItemId, 'IMAGE_BREAKDOWN', null);
          if (existingForm?.entity.kind === 'IMAGE_BREAKDOWN') {
            const existing = this.get(existingForm.entity.id);
            const breakdown =
              existing.sourceAsset.id === parsed.sourceAssetId
                ? existing
                : this.replaceSource(existing.id, parsed.sourceAssetId);
            return { breakdown, creationItemId: sourceForm.creationItemId };
          }
        }
        const id = ulid();
        const timestamp = now();
        const title = parsed.locale === 'zh' ? '拆解图片' : 'Image breakdown';
        this.db
          .prepare(
            `INSERT INTO image_breakdowns (
              id, source_asset_id, title, focus, route_key, model_key, status,
              result_json, error_code, error_message, created_at, updated_at, archived_at, deleted_at
            ) VALUES (?, ?, ?, '', 'GOOGLE_GEMINI', NULL, 'DRAFT', NULL, NULL, NULL, ?, ?, NULL, NULL)`,
          )
          .run(id, parsed.sourceAssetId, title, timestamp, timestamp);
        const form = {
          role: 'IMAGE_BREAKDOWN' as const,
          entity: { kind: 'IMAGE_BREAKDOWN' as const, id },
          anchorKey: null,
        };
        const registration = sourceForm
          ? creationItems.addForm({
              creationItemId: sourceForm.creationItemId,
              sourceFormId: sourceForm.id,
              ...form,
            })
          : creationItems.createWithForm({
              albumId: parsed.albumId,
              form,
            });
        this.storage.recordChange('IMAGE_BREAKDOWN', id, 'CREATE', {
          sourceAssetId: parsed.sourceAssetId,
          creationItemId: registration.item.id,
          sourceFormId: sourceForm?.id ?? null,
        });
        return { breakdown: this.get(id), creationItemId: registration.item.id };
      })
      .immediate();
  }

  replaceSource(id: string, sourceAssetId: string) {
    return this.db
      .transaction(() => {
        this.mutableRow(id);
        this.assetRow(sourceAssetId);
        const timestamp = now();
        this.db
          .prepare(
            `UPDATE image_breakdowns
            SET source_asset_id = ?, model_key = NULL, status = 'DRAFT', result_json = NULL,
              error_code = NULL, error_message = NULL, updated_at = ?
            WHERE id = ?`,
          )
          .run(sourceAssetId, timestamp, id);
        new CreationItemRepository(this.storage).touchForEntity({ kind: 'IMAGE_BREAKDOWN', id }, timestamp);
        this.storage.recordChange('IMAGE_BREAKDOWN', id, 'REPLACE_SOURCE', { sourceAssetId });
        return this.get(id);
      })
      .immediate();
  }

  begin(id: string, focus: string, routeKey: ImageBreakdownRouteKey, modelKey: string) {
    const parsedRouteKey = imageBreakdownRouteKeySchema.parse(routeKey);
    return this.db
      .transaction(() => {
        this.mutableRow(id);
        const timestamp = now();
        this.db
          .prepare(
            `UPDATE image_breakdowns
            SET focus = ?, route_key = ?, model_key = ?, status = 'RUNNING',
              error_code = NULL, error_message = NULL, updated_at = ?
            WHERE id = ?`,
          )
          .run(focus.trim(), parsedRouteKey, modelKey, timestamp, id);
        new CreationItemRepository(this.storage).touchForEntity({ kind: 'IMAGE_BREAKDOWN', id }, timestamp);
        this.storage.recordChange('IMAGE_BREAKDOWN', id, 'RUN', { routeKey: parsedRouteKey, modelKey });
        return this.get(id);
      })
      .immediate();
  }

  succeed(id: string, result: ImageBreakdownResult) {
    const parsed = imageBreakdownResultSchema.parse(result);
    return this.db
      .transaction(() => {
        const existing = this.mutableRow(id);
        if (text(existing.status) !== 'RUNNING') throw new Error('Image breakdown is not running');
        const timestamp = now();
        this.db
          .prepare(
            `UPDATE image_breakdowns
            SET status = 'SUCCEEDED', result_json = ?, error_code = NULL,
              error_message = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(JSON.stringify(parsed), timestamp, id);
        new CreationItemRepository(this.storage).touchForEntity({ kind: 'IMAGE_BREAKDOWN', id }, timestamp);
        this.storage.recordChange('IMAGE_BREAKDOWN', id, 'SUCCEED', { modelKey: existing.model_key });
        return this.get(id);
      })
      .immediate();
  }

  fail(id: string, code: string, message: string) {
    return this.db
      .transaction(() => {
        const existing = this.mutableRow(id);
        if (text(existing.status) !== 'RUNNING') return this.get(id);
        const timestamp = now();
        this.db
          .prepare(
            `UPDATE image_breakdowns
            SET status = 'FAILED', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
          )
          .run(code.slice(0, 200) || 'UNKNOWN', message.slice(0, 2_000) || 'Image breakdown failed', timestamp, id);
        new CreationItemRepository(this.storage).touchForEntity({ kind: 'IMAGE_BREAKDOWN', id }, timestamp);
        this.storage.recordChange('IMAGE_BREAKDOWN', id, 'FAIL', { code });
        return this.get(id);
      })
      .immediate();
  }

  prompt(id: string, kind: 'FULL' | 'STYLE' | 'COMPOSITION_LIGHT') {
    const breakdown = this.get(id);
    if (!breakdown.result) throw new Error('Run image breakdown before creating from a prompt');
    if (kind === 'STYLE') return breakdown.result.prompts.style;
    if (kind === 'COMPOSITION_LIGHT') return breakdown.result.prompts.compositionLight;
    return breakdown.result.prompts.full;
  }

  imageForm(id: string) {
    const row = this.db
      .prepare(
        `SELECT series.id AS series_id, series.current_version_id AS version_id
        FROM creation_forms breakdown_form
        JOIN creation_forms image_form
          ON image_form.creation_item_id = breakdown_form.creation_item_id
          AND image_form.role = 'IMAGE_CREATION' AND image_form.deleted_at IS NULL
        JOIN prompt_series series
          ON series.id = image_form.entity_id AND series.deleted_at IS NULL
        WHERE breakdown_form.entity_type = 'IMAGE_BREAKDOWN'
          AND breakdown_form.entity_id = ? AND breakdown_form.deleted_at IS NULL
          AND series.current_version_id IS NOT NULL
        LIMIT 1`,
      )
      .get(id) as JsonMap | undefined;
    return row ? { seriesId: text(row.series_id), versionId: text(row.version_id) } : null;
  }

  private row(id: string) {
    const row = this.db
      .prepare(
        `SELECT breakdown.*, asset.id AS asset_id, asset.kind AS asset_kind,
          asset.origin_type AS asset_origin_type, asset.width AS asset_width,
          asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM image_breakdowns breakdown
        JOIN image_assets asset ON asset.id = breakdown.source_asset_id
        WHERE breakdown.id = ?`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Image breakdown not found');
    return row;
  }

  private mutableRow(id: string) {
    const row = this.row(id);
    if (row.deleted_at != null) throw new Error('Deleted image breakdowns cannot be changed');
    if (row.archived_at != null) throw new Error('Archived image breakdowns cannot be changed');
    return row;
  }

  private assetRow(id: string) {
    const row = this.db.prepare('SELECT * FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(id) as
      JsonMap | undefined;
    if (!row) throw new Error('Source image is unavailable');
    return row;
  }

  private dto(row: JsonMap): ImageBreakdownDto {
    return imageBreakdownSchema.parse({
      id: row.id,
      title: row.title,
      sourceAsset: assetDto({
        id: row.asset_id,
        kind: row.asset_kind,
        origin_type: row.asset_origin_type,
        width: row.asset_width,
        height: row.asset_height,
        mime_type: row.asset_mime_type,
        byte_size: row.asset_byte_size,
        created_at: row.asset_created_at,
      }),
      focus: row.focus,
      routeKey: row.route_key,
      modelKey: row.model_key == null ? null : row.model_key,
      status: row.status,
      result: parsedResult(row.result_json),
      errorCode: row.error_code == null ? null : row.error_code,
      errorMessage: row.error_message == null ? null : row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

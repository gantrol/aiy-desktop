import { createHash } from 'node:crypto';
import path from 'node:path';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { AnnotationDto, AnnotationHistoryReuseResult } from '@/shared/contracts';
import {
  IMAGE_EDIT_MASK_RASTERIZER_VERSION,
  rasterizeImageEditGuide,
  rasterizeImageEditMask,
} from '@/main/image-edit/mask-rasterizer';
import type { LibraryStorage } from '@/main/database/core/storage';
import { annotationDto, type JsonMap, now, text } from '@/main/database/core/values';

export type PersistedImageEditMode = 'SEMANTIC' | 'MASK';

export interface GenerationEditArtifactRecord {
  id: string;
  kind: 'MASK' | 'ANNOTATION_GUIDE';
  objectHash: string;
  localPath: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface GenerationEditSpecRecord {
  promptVersionId: string;
  sourceAssetId: string;
  mode: PersistedImageEditMode;
  annotations: AnnotationDto[];
  annotationSnapshotHash: string;
  rasterizerVersion: number;
  mask: GenerationEditArtifactRecord | null;
}

const frozenBrushPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const frozenBrushGeometrySchema = z
  .object({
    version: z.literal(1),
    strokes: z
      .array(
        z
          .object({
            mode: z.enum(['ADD', 'ERASE']),
            radius: z.number().min(0.001).max(0.25),
            points: z.array(frozenBrushPointSchema).min(1).max(2_048),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
const frozenAnnotationSchema = z
  .object({
    id: z.string().min(1).max(500),
    imageAssetId: z.string().min(1).max(500),
    type: z.enum(['RECTANGLE', 'BRUSH']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).nullable(),
    height: z.number().min(0).max(1).nullable(),
    geometry: frozenBrushGeometrySchema.nullable(),
    comment: z
      .string()
      .max(2_000)
      .refine((value) => Boolean(value.trim())),
    status: z.literal('OPEN'),
    createdAt: z.string().min(1).max(100),
  })
  .strict()
  .superRefine((annotation, context) => {
    if (annotation.type === 'RECTANGLE') {
      if (annotation.width == null || annotation.height == null || annotation.width <= 0 || annotation.height <= 0) {
        context.addIssue({ code: 'custom', message: 'Frozen rectangle annotation has no positive range' });
      } else if (annotation.x + annotation.width > 1 || annotation.y + annotation.height > 1) {
        context.addIssue({ code: 'custom', message: 'Frozen rectangle annotation exceeds the image bounds' });
      }
      if (annotation.geometry != null) {
        context.addIssue({ code: 'custom', message: 'Frozen rectangle annotation includes brush geometry' });
      }
    } else if (!annotation.geometry) {
      context.addIssue({ code: 'custom', message: 'Frozen brush annotation has no geometry' });
    } else {
      const pointCount = annotation.geometry.strokes.reduce((total, stroke) => total + stroke.points.length, 0);
      if (pointCount > 10_000) {
        context.addIssue({ code: 'custom', message: 'Frozen brush annotation has too many points' });
      }
      if (!annotation.geometry.strokes.some((stroke) => stroke.mode === 'ADD')) {
        context.addIssue({ code: 'custom', message: 'Frozen brush annotation has no editable stroke' });
      }
    }
  });
const frozenAnnotationSnapshotSchema = z
  .array(frozenAnnotationSchema)
  .min(1)
  .max(100)
  .superRefine((annotations, context) => {
    const ids = new Set<string>();
    for (const [index, annotation] of annotations.entries()) {
      if (ids.has(annotation.id)) {
        context.addIssue({ code: 'custom', message: 'Frozen annotation IDs must be unique', path: [index, 'id'] });
      }
      ids.add(annotation.id);
    }
  });

function parseFrozenAnnotationSnapshot(value: string, expectedHash?: string): AnnotationDto[] {
  if (expectedHash && createHash('sha256').update(value).digest('hex') !== expectedHash) {
    throw new Error('Stored image edit annotation snapshot does not match its content hash');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Stored image edit annotation snapshot is not JSON: ${String(error)}`);
  }
  const decoded = frozenAnnotationSnapshotSchema.safeParse(parsed);
  if (!decoded.success) {
    const diagnostics = decoded.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Stored image edit annotation snapshot is malformed: ${diagnostics}`);
  }
  return decoded.data;
}

function annotationSnapshot(annotations: readonly AnnotationDto[]) {
  return annotations.map((annotation) => ({
    id: annotation.id,
    imageAssetId: annotation.imageAssetId,
    type: annotation.type,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    geometry: annotation.geometry,
    comment: annotation.comment,
    status: annotation.status,
    createdAt: annotation.createdAt,
  }));
}

export class ImageEditRepository {
  private readonly db;

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  persistForRun(
    runId: string,
    sourceAssetId: string,
    mode: PersistedImageEditMode,
    annotations: readonly AnnotationDto[],
  ): GenerationEditSpecRecord {
    const run = this.db
      .prepare(
        `SELECT run.prompt_version_id, version.source_image_id,
        asset.width, asset.height, asset.mime_type
      FROM generation_runs run
      JOIN prompt_versions version ON version.id = run.prompt_version_id
      JOIN image_assets asset ON asset.id = version.source_image_id
      WHERE run.id = ? AND asset.deleted_at IS NULL`,
      )
      .get(runId) as JsonMap | undefined;
    if (!run) throw new Error('Image edit generation run is unavailable');
    const promptVersionId = text(run.prompt_version_id);
    if (text(run.source_image_id) !== sourceAssetId)
      throw new Error('Image edit source does not match the frozen version');
    if (!annotations.length) throw new Error('Image edit requires at least one annotation');
    if (
      annotations.some(
        (annotation) =>
          annotation.imageAssetId !== sourceAssetId || annotation.status !== 'OPEN' || !annotation.comment.trim(),
      )
    )
      throw new Error('Image edit annotations are no longer actionable');

    const snapshotJson = JSON.stringify(annotationSnapshot(annotations));
    const snapshotHash = createHash('sha256').update(snapshotJson).digest('hex');
    const width = Number(run.width);
    const height = Number(run.height);
    if (mode === 'MASK' && text(run.mime_type) !== 'image/png') {
      throw new Error('Native mask editing currently requires a PNG source image');
    }

    // Freeze one deterministic range for every targeted edit. Native-mask
    // providers map its alpha mask to their mask field; other providers derive
    // a visible guide from the same immutable annotation snapshot.
    const maskBytes = rasterizeImageEditMask(annotations, width, height);
    if (maskBytes.byteLength > 50 * 1024 * 1024) throw new Error('Image edit mask exceeds 50 MB');
    const stored = this.storage.storeBuffer(maskBytes, '.png');
    const existingMask = this.db
      .prepare(
        `SELECT id FROM image_edit_artifacts
      WHERE kind = 'MASK' AND object_hash = ?`,
      )
      .get(stored.hash) as JsonMap | undefined;
    const maskArtifactId = existingMask ? text(existingMask.id) : ulid();
    if (!existingMask) {
      this.db
        .prepare(
          `INSERT INTO image_edit_artifacts
        (id, kind, object_hash, relative_path, mime_type, width, height, byte_size, created_at)
        VALUES (?, 'MASK', ?, ?, 'image/png', ?, ?, ?, ?)`,
        )
        .run(maskArtifactId, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, now());
    }

    this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT source_asset_id, mode, annotation_snapshot_hash,
          mask_artifact_id, rasterizer_version
        FROM generation_edit_specs WHERE prompt_version_id = ?`,
        )
        .get(promptVersionId) as JsonMap | undefined;
      if (existing) {
        if (
          text(existing.source_asset_id) !== sourceAssetId ||
          text(existing.mode) !== mode ||
          text(existing.annotation_snapshot_hash) !== snapshotHash ||
          (existing.mask_artifact_id ? text(existing.mask_artifact_id) : null) !== maskArtifactId ||
          Number(existing.rasterizer_version) !== IMAGE_EDIT_MASK_RASTERIZER_VERSION
        )
          throw new Error('The image edit version already has a different frozen execution spec');
        return;
      }
      this.db
        .prepare(
          `INSERT INTO generation_edit_specs
        (prompt_version_id, source_asset_id, mode, annotation_snapshot_json, annotation_snapshot_hash,
         mask_artifact_id, rasterizer_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          promptVersionId,
          sourceAssetId,
          mode,
          snapshotJson,
          snapshotHash,
          maskArtifactId,
          IMAGE_EDIT_MASK_RASTERIZER_VERSION,
          now(),
        );
      this.storage.recordChange('GENERATION_EDIT_SPEC', promptVersionId, 'CREATE', {
        sourceAssetId,
        mode,
        annotationSnapshotHash: snapshotHash,
        maskArtifactId,
        rasterizerVersion: IMAGE_EDIT_MASK_RASTERIZER_VERSION,
      });
    })();
    return this.forRun(runId)!;
  }

  forRun(runId: string): GenerationEditSpecRecord | null {
    const row = this.db
      .prepare(
        `SELECT spec.prompt_version_id, spec.source_asset_id, spec.mode,
        spec.annotation_snapshot_json, spec.annotation_snapshot_hash, spec.rasterizer_version,
        artifact.id AS artifact_id, artifact.kind AS artifact_kind, artifact.object_hash,
        artifact.relative_path, artifact.mime_type, artifact.width, artifact.height, artifact.byte_size
      FROM generation_runs run
      JOIN generation_edit_specs spec ON spec.prompt_version_id = run.prompt_version_id
      LEFT JOIN image_edit_artifacts artifact ON artifact.id = spec.mask_artifact_id
      WHERE run.id = ?`,
      )
      .get(runId) as JsonMap | undefined;
    if (!row) return null;
    return {
      promptVersionId: text(row.prompt_version_id),
      sourceAssetId: text(row.source_asset_id),
      mode: text(row.mode) === 'MASK' ? 'MASK' : 'SEMANTIC',
      annotations: parseFrozenAnnotationSnapshot(
        text(row.annotation_snapshot_json),
        text(row.annotation_snapshot_hash),
      ),
      annotationSnapshotHash: text(row.annotation_snapshot_hash),
      rasterizerVersion: Number(row.rasterizer_version),
      mask: row.artifact_id
        ? {
            id: text(row.artifact_id),
            kind: text(row.artifact_kind) === 'ANNOTATION_GUIDE' ? 'ANNOTATION_GUIDE' : 'MASK',
            objectHash: text(row.object_hash),
            localPath: this.absoluteObjectPath(text(row.relative_path)),
            mimeType: text(row.mime_type),
            width: Number(row.width),
            height: Number(row.height),
            byteSize: Number(row.byte_size),
          }
        : null,
    };
  }

  annotationGuideForRun(runId: string): GenerationEditArtifactRecord | null {
    const spec = this.forRun(runId);
    if (!spec?.mask) return null;
    const guideBytes = rasterizeImageEditGuide(spec.annotations, spec.mask.width, spec.mask.height);
    if (guideBytes.byteLength > 50 * 1024 * 1024) throw new Error('Image edit annotation guide exceeds 50 MB');
    const stored = this.storage.storeBuffer(guideBytes, '.png');
    const existing = this.db
      .prepare(
        `SELECT id FROM image_edit_artifacts
      WHERE kind = 'ANNOTATION_GUIDE' AND object_hash = ?`,
      )
      .get(stored.hash) as JsonMap | undefined;
    const id = existing ? text(existing.id) : ulid();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO image_edit_artifacts
        (id, kind, object_hash, relative_path, mime_type, width, height, byte_size, created_at)
        VALUES (?, 'ANNOTATION_GUIDE', ?, ?, 'image/png', ?, ?, ?, ?)`,
        )
        .run(id, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, now());
    }
    return {
      id,
      kind: 'ANNOTATION_GUIDE',
      objectHash: stored.hash,
      localPath: this.absoluteObjectPath(stored.relativePath),
      mimeType: 'image/png',
      width: stored.width,
      height: stored.height,
      byteSize: stored.byteSize,
    };
  }

  reuseAnnotationsForVersion(promptVersionId: string): AnnotationHistoryReuseResult | null {
    const row = this.db
      .prepare(
        `SELECT source_asset_id, annotation_snapshot_json, annotation_snapshot_hash
      FROM generation_edit_specs WHERE prompt_version_id = ?`,
      )
      .get(promptVersionId) as JsonMap | undefined;
    if (!row) return null;
    const sourceAssetId = text(row.source_asset_id);
    const snapshotHash = text(row.annotation_snapshot_hash);
    const frozenAnnotations = parseFrozenAnnotationSnapshot(text(row.annotation_snapshot_json), snapshotHash);
    if (frozenAnnotations.some((annotation) => annotation.imageAssetId !== sourceAssetId)) {
      throw new Error('Stored image edit annotations do not match their frozen source image');
    }

    return this.db.transaction(() => {
      const asset = this.db
        .prepare('SELECT id FROM image_assets WHERE id = ? AND deleted_at IS NULL')
        .get(sourceAssetId) as JsonMap | undefined;
      if (!asset) throw new Error('The frozen image edit source is unavailable');

      const currentRows = this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
        FROM annotations annotation
        LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
        WHERE annotation.image_asset_id = ?
        ORDER BY annotation.created_at, annotation.id`,
        )
        .all(sourceAssetId) as JsonMap[];
      const currentAnnotations = currentRows.map(annotationDto);
      const currentById = new Map(currentAnnotations.map((annotation) => [annotation.id, annotation]));
      const frozenIds = new Set(frozenAnnotations.map((annotation) => annotation.id));
      const supersededOpen = currentAnnotations.filter(
        (annotation) => annotation.status === 'OPEN' && !frozenIds.has(annotation.id),
      );
      const dismissAnnotation = this.db.prepare("UPDATE annotations SET status = 'DISMISSED' WHERE id = ?");
      for (const annotation of supersededOpen) {
        dismissAnnotation.run(annotation.id);
        this.storage.recordChange('ANNOTATION', annotation.id, 'SET_STATUS', {
          imageAssetId: sourceAssetId,
          from: 'OPEN',
          to: 'DISMISSED',
          reason: 'HISTORY_REUSE',
        });
      }

      const insertAnnotation = this.db.prepare(
        `INSERT INTO annotations
        (id, image_asset_id, type, x, y, width, height, comment, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      );
      const updateAnnotation = this.db.prepare(
        `UPDATE annotations
        SET type = ?, x = ?, y = ?, width = ?, height = ?, comment = ?, status = 'OPEN'
        WHERE id = ?`,
      );
      const upsertRegion = this.db.prepare(
        `INSERT INTO annotation_regions
        (annotation_id, schema_version, geometry_json, content_hash, created_at)
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(annotation_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          geometry_json = excluded.geometry_json,
          content_hash = excluded.content_hash`,
      );
      const deleteRegion = this.db.prepare('DELETE FROM annotation_regions WHERE annotation_id = ?');
      const annotations = frozenAnnotations.map((frozen): AnnotationDto => {
        const current = currentById.get(frozen.id);
        const comment = frozen.comment.trim();
        const createdAt = current?.createdAt ?? frozen.createdAt;
        if (current) {
          updateAnnotation.run(frozen.type, frozen.x, frozen.y, frozen.width, frozen.height, comment, frozen.id);
        } else {
          insertAnnotation.run(
            frozen.id,
            sourceAssetId,
            frozen.type,
            frozen.x,
            frozen.y,
            frozen.width,
            frozen.height,
            comment,
            createdAt,
          );
        }
        let geometryHash: string | null = null;
        if (frozen.geometry) {
          const geometryJson = JSON.stringify(frozen.geometry);
          geometryHash = createHash('sha256').update(geometryJson).digest('hex');
          upsertRegion.run(frozen.id, geometryJson, geometryHash, createdAt);
        } else {
          deleteRegion.run(frozen.id);
        }
        const restored =
          !current ||
          current.status !== 'OPEN' ||
          current.type !== frozen.type ||
          current.x !== frozen.x ||
          current.y !== frozen.y ||
          current.width !== frozen.width ||
          current.height !== frozen.height ||
          current.comment !== comment ||
          JSON.stringify(current.geometry) !== JSON.stringify(frozen.geometry);
        if (restored)
          this.storage.recordChange('ANNOTATION', frozen.id, 'RESTORE_HISTORY', {
            imageAssetId: sourceAssetId,
            type: frozen.type,
            geometryHash,
            promptVersionId,
            annotationSnapshotHash: snapshotHash,
          });
        return {
          ...frozen,
          imageAssetId: sourceAssetId,
          comment,
          createdAt,
        };
      });
      this.storage.recordChange('GENERATION_EDIT_SPEC', promptVersionId, 'REUSE_ANNOTATIONS', {
        sourceAssetId,
        annotationSnapshotHash: snapshotHash,
        annotationIds: annotations.map((annotation) => annotation.id),
      });
      return { imageAssetId: sourceAssetId, annotations };
    })();
  }

  private absoluteObjectPath(relativePath: string) {
    if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Image edit artifact path is invalid');
    const root = path.resolve(this.storage.libraryRoot);
    const candidate = path.resolve(root, ...relativePath.split(/[\\/]/u));
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error('Image edit artifact escaped the library root');
    return candidate;
  }
}

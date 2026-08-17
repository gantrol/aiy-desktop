import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AnnotationBrushGeometry,
  AnnotationDto,
  AnnotationInput,
  AnnotationStatusInput,
  AnnotationUpdateInput,
} from '@/shared/contracts';
import { annotationDto, type JsonMap, now, text } from '@/main/database/core/values';
import { WorkbenchRunRepository } from '@/main/database/generation/workbench-run-repository';
import { brushBounds } from '@/main/database/generation/workbench-values';

export class WorkbenchRepository extends WorkbenchRunRepository {
  listAnnotations(assetId: string): AnnotationDto[] {
    return (
      this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
        FROM annotations annotation
        LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
        WHERE annotation.image_asset_id = ? ORDER BY annotation.created_at`,
        )
        .all(assetId) as JsonMap[]
    ).map(annotationDto);
  }

  addAnnotation(input: AnnotationInput): AnnotationDto {
    return this.db.transaction(() => {
      const id = ulid();
      const createdAt = now();
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      let geometry: AnnotationBrushGeometry | null = null;
      let x = clamp(input.x);
      let y = clamp(input.y);
      let width = input.width == null ? null : clamp(input.width);
      let height = input.height == null ? null : clamp(input.height);
      if (input.type === 'BRUSH') {
        if (!input.geometry) throw new Error('Brush annotation geometry is required');
        const asset = this.db
          .prepare(
            `SELECT width, height FROM image_assets
            WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(input.imageAssetId) as JsonMap | undefined;
        if (!asset) throw new Error('Annotation image is unavailable');
        geometry = input.geometry;
        const bounds = brushBounds(geometry, Number(asset.width), Number(asset.height));
        ({ x, y, width, height } = bounds);
      }
      this.db
        .prepare(
          `INSERT INTO annotations
          (id, image_asset_id, type, x, y, width, height, comment, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        )
        .run(id, input.imageAssetId, input.type, x, y, width, height, input.comment.trim(), createdAt);
      let geometryHash: string | null = null;
      if (geometry) {
        const geometryJson = JSON.stringify(geometry);
        geometryHash = createHash('sha256').update(geometryJson).digest('hex');
        this.db
          .prepare(
            `INSERT INTO annotation_regions
            (annotation_id, schema_version, geometry_json, content_hash, created_at)
            VALUES (?, 1, ?, ?, ?)`,
          )
          .run(id, geometryJson, geometryHash, createdAt);
      }
      this.storage.recordChange('ANNOTATION', id, 'CREATE', {
        imageAssetId: input.imageAssetId,
        type: input.type,
        geometryHash,
      });
      return {
        id,
        imageAssetId: input.imageAssetId,
        type: input.type,
        x,
        y,
        width,
        height,
        geometry,
        comment: input.comment.trim(),
        status: 'OPEN' as const,
        createdAt,
      };
    })();
  }

  updateAnnotation(input: AnnotationUpdateInput): AnnotationDto {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
          FROM annotations annotation
          LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
          WHERE annotation.id = ?`,
        )
        .get(input.annotationId) as JsonMap | undefined;
      if (!row) throw new Error(`Annotation not found: ${input.annotationId}`);
      const annotation = annotationDto(row);
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      let geometry: AnnotationBrushGeometry | null = null;
      let x = clamp(input.x);
      let y = clamp(input.y);
      let width = input.width == null ? null : clamp(input.width);
      let height = input.height == null ? null : clamp(input.height);
      if (input.type === 'BRUSH') {
        if (!input.geometry) throw new Error('Brush annotation geometry is required');
        const asset = this.db
          .prepare(
            `SELECT width, height FROM image_assets
            WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(annotation.imageAssetId) as JsonMap | undefined;
        if (!asset) throw new Error('Annotation image is unavailable');
        geometry = input.geometry;
        const bounds = brushBounds(geometry, Number(asset.width), Number(asset.height));
        ({ x, y, width, height } = bounds);
      }
      const comment = input.comment.trim();
      this.db
        .prepare(
          `UPDATE annotations
          SET type = ?, x = ?, y = ?, width = ?, height = ?, comment = ?
          WHERE id = ?`,
        )
        .run(input.type, x, y, width, height, comment, input.annotationId);
      let geometryHash: string | null = null;
      if (geometry) {
        const geometryJson = JSON.stringify(geometry);
        geometryHash = createHash('sha256').update(geometryJson).digest('hex');
        this.db
          .prepare(
            `INSERT INTO annotation_regions
            (annotation_id, schema_version, geometry_json, content_hash, created_at)
            VALUES (?, 1, ?, ?, ?)
            ON CONFLICT(annotation_id) DO UPDATE SET
              schema_version = excluded.schema_version,
              geometry_json = excluded.geometry_json,
              content_hash = excluded.content_hash`,
          )
          .run(input.annotationId, geometryJson, geometryHash, now());
      } else {
        this.db.prepare('DELETE FROM annotation_regions WHERE annotation_id = ?').run(input.annotationId);
      }
      this.storage.recordChange('ANNOTATION', input.annotationId, 'UPDATE', {
        imageAssetId: annotation.imageAssetId,
        type: input.type,
        geometryHash,
        commentChanged: comment !== annotation.comment,
      });
      return {
        ...annotation,
        type: input.type,
        x,
        y,
        width,
        height,
        geometry,
        comment,
      };
    })();
  }

  setAnnotationStatus(input: AnnotationStatusInput): AnnotationDto {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
          FROM annotations annotation
          LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
          WHERE annotation.id = ?`,
        )
        .get(input.annotationId) as JsonMap | undefined;
      if (!row) throw new Error(`Annotation not found: ${input.annotationId}`);
      const annotation = annotationDto(row);
      if (annotation.status === input.status) return annotation;

      this.db.prepare('UPDATE annotations SET status = ? WHERE id = ?').run(input.status, input.annotationId);
      this.storage.recordChange('ANNOTATION', input.annotationId, 'SET_STATUS', {
        imageAssetId: annotation.imageAssetId,
        from: annotation.status,
        to: input.status,
      });
      return { ...annotation, status: input.status };
    })();
  }

  getReferencePaths(assetIds: string[]) {
    return assetIds.map((id) => this.getAssetPath(id)).filter((item): item is string => Boolean(item));
  }

  getLibraryName() {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'library_name'").get() as JsonMap | undefined;
    return text(row?.value) || '本地图鉴';
  }
}

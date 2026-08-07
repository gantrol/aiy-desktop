import { ulid } from 'ulid';
import type { ImageRatingDimension, ImageRatingDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

const evaluatorKey = 'LOCAL_OWNER';
const dimensions: ImageRatingDimension[] = ['AESTHETIC', 'REALISM'];

function toRating(row: JsonMap): ImageRatingDto {
  return {
    id: text(row.id),
    imageAssetId: text(row.image_asset_id),
    dimension: text(row.dimension) as ImageRatingDimension,
    score: Number(row.score),
    updatedAt: text(row.updated_at),
  };
}

export class RatingRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  list(): ImageRatingDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_ratings
      WHERE evaluator_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      )
      .all(evaluatorKey) as JsonMap[];
    return rows.map(toRating);
  }

  set(imageAssetId: string, dimension: ImageRatingDimension, score: number | null): ImageRatingDto | null {
    if (!dimensions.includes(dimension)) throw new Error('Unknown rating dimension');
    return this.db.transaction(() => {
      const asset = this.db
        .prepare('SELECT id FROM image_assets WHERE id = ? AND deleted_at IS NULL')
        .get(imageAssetId) as JsonMap | undefined;
      if (!asset) throw new Error('Image not found');

      const existing = this.db
        .prepare(
          `SELECT * FROM image_ratings
        WHERE image_asset_id = ? AND evaluator_key = ? AND dimension = ?`,
        )
        .get(imageAssetId, evaluatorKey, dimension) as JsonMap | undefined;
      const timestamp = now();

      if (score == null) {
        if (!existing || existing.deleted_at) return null;
        const ratingId = text(existing.id);
        this.db
          .prepare('UPDATE image_ratings SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(timestamp, timestamp, ratingId);
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'IMAGE_RATING', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), ratingId, timestamp);
        this.storage.recordChange('IMAGE_RATING', ratingId, 'DELETE', { imageAssetId, dimension });
        return null;
      }

      if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Score must be an integer from 1 to 5');

      if (existing) {
        const ratingId = text(existing.id);
        this.db
          .prepare('UPDATE image_ratings SET score = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
          .run(score, timestamp, ratingId);
        this.storage.recordChange('IMAGE_RATING', ratingId, existing.deleted_at ? 'RESTORE' : 'SET_SCORE', {
          imageAssetId,
          dimension,
          score,
        });
        return toRating(this.db.prepare('SELECT * FROM image_ratings WHERE id = ?').get(ratingId) as JsonMap);
      }

      const ratingId = ulid();
      this.db
        .prepare(
          `INSERT INTO image_ratings(
        id, image_asset_id, evaluator_key, dimension, score, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(ratingId, imageAssetId, evaluatorKey, dimension, score, timestamp, timestamp);
      this.storage.recordChange('IMAGE_RATING', ratingId, 'CREATE', { imageAssetId, dimension, score });
      return toRating(this.db.prepare('SELECT * FROM image_ratings WHERE id = ?').get(ratingId) as JsonMap);
    })();
  }
}

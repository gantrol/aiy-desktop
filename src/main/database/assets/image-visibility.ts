import type Database from 'better-sqlite3';
import { imageVisibilityUpdateSchema, type ImageVisibilityUpdate } from '@/shared/contracts/image-visibility';

const keyPrefix = 'image_visibility:';

/** Local display preferences, scoped to this library; never part of image/search identity. */
export function createImageVisibilityRepository(db: Database.Database) {
  return {
    list(): string[] {
      return db
        .prepare("SELECT substr(key, ?) FROM app_meta WHERE key GLOB 'image_visibility:*' AND value = 'hidden'")
        .pluck()
        .all(keyPrefix.length + 1) as string[];
    },
    set(raw: ImageVisibilityUpdate) {
      const input = imageVisibilityUpdateSchema.parse(raw);
      const ids = [...new Set(input.assetIds)];
      const json = JSON.stringify(ids);
      // One bounded transaction and set-oriented statements, with no file or per-image queries.
      db.transaction(() => {
        const count = db
          .prepare(
            `SELECT COUNT(*) FROM image_assets
          WHERE id IN (SELECT value FROM json_each(?)) AND mime_type LIKE 'image/%'`,
          )
          .pluck()
          .get(json);
        if (count !== ids.length) throw new Error('Image is unavailable');
        if (input.hidden) {
          db.prepare(
            `INSERT INTO app_meta(key, value)
            SELECT ? || value, 'hidden' FROM json_each(?) WHERE true
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ).run(keyPrefix, json);
        } else {
          db.prepare('DELETE FROM app_meta WHERE key IN (SELECT ? || value FROM json_each(?))').run(keyPrefix, json);
        }
      })();
    },
  };
}

import type Database from 'better-sqlite3';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
import { userProfileSchema } from '@/shared/contracts/me';
import sql from '@/main/database/sql/v03-revision-009-authors.sql?raw';

const marker = 'creation-authors.v1';

export function authorRegistryComplete(db: Database.Database) {
  return (
    tableNames(db).has('creation_authors') &&
    columnNames(db, 'creation_items').has('author_revision') &&
    typeof db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(marker) === 'string'
  );
}

/** Runs inside the schema transaction. Revision bodies and historical events stay unchanged. */
export function ensureAuthorRegistry(db: Database.Database, userId: string) {
  if (authorRegistryComplete(db)) return;
  db.exec(sql);
  const value = db.prepare("SELECT value FROM app_meta WHERE key='user_profile'").pluck().get();
  const profile = userProfileSchema.parse(typeof value === 'string' ? JSON.parse(value) : { authorName: '' });
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO creation_authors(id,name,avatar_data_url,created_at,updated_at) VALUES(?,?,?,?,?)').run(
    userId,
    profile.authorName,
    profile.avatarDataUrl ?? null,
    timestamp,
    timestamp,
  );
  // The pre-registry build guessed ownership for unnamed legacy creations.
  // Revert only that inference; new creations carry the chosen identity in CREATE.
  const restored = db
    .prepare(
      `UPDATE creation_items SET author_id=NULL
    WHERE author_id=@userId AND (author_name IS NULL OR TRIM(author_name)='')
    AND NOT EXISTS (SELECT 1 FROM change_events event
      WHERE event.entity_type='CREATION_ITEM' AND event.entity_id=creation_items.id
        AND event.operation IN ('CREATE','SET_AUTHOR')
        AND json_extract(event.payload_json,'$.authorId')=@userId)`,
    )
    .run({ userId });
  // The registry is the authority after migration, including the current user's profile.
  db.prepare("DELETE FROM app_meta WHERE key='user_profile'").run();
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(
    marker,
    JSON.stringify({ migratedAt: timestamp, restoredLegacyBindings: restored.changes }),
  );
}

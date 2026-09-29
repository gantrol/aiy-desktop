import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { userProfileSchema, type UserProfile } from '@/shared/contracts/me';
import type { LibraryStorage } from '@/main/database/core/storage';

const identityKey = 'user_profile_id';

export function hasUserProfileIdentity(db: Database.Database) {
  return typeof db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(identityKey) === 'string';
}

/** Called by the schema migration, including when a profile has not been named yet. */
export function ensureUserProfileIdentity(db: Database.Database) {
  db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)').run(identityKey, randomUUID());
  return userProfileSchema.shape.id
    .unwrap()
    .parse(db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(identityKey));
}

export function readUserProfile(db: Database.Database): UserProfile & { id: string } {
  const row = db
    .prepare(
      `SELECT author.id,author.name,author.avatar_data_url,author.revision
    FROM creation_authors author JOIN app_meta meta ON meta.key=? AND meta.value=author.id`,
    )
    .get(identityKey) as { id: string; name: string; avatar_data_url: string | null; revision: number } | undefined;
  if (!row) throw new Error('ME_PROFILE_IDENTITY_UNAVAILABLE');
  return {
    ...userProfileSchema.parse({
      id: row.id,
      authorName: row.name,
      avatarDataUrl: row.avatar_data_url,
      revision: row.revision,
    }),
    id: row.id,
  };
}

export function saveUserProfile(storage: LibraryStorage, profile: UserProfile) {
  const parsed = userProfileSchema.parse(profile);
  return storage.db.transaction(() => {
    const current = readUserProfile(storage.db);
    if (parsed.id && parsed.id !== current.id) throw new Error('ME_PROFILE_IDENTITY_CHANGED');
    if (parsed.revision && parsed.revision !== current.revision) throw new Error('AUTHOR_CHANGED');
    storage.db
      .prepare('UPDATE creation_authors SET name=?,avatar_data_url=?,revision=revision+1,updated_at=? WHERE id=?')
      .run(parsed.authorName, parsed.avatarDataUrl ?? null, new Date().toISOString(), current.id);
    const next = readUserProfile(storage.db);
    storage.recordChange('USER_PROFILE', current.id, 'UPDATE', next);
    return next;
  })();
}

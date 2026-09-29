import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-009-creation-author.sql?raw';
import identitySql from '@/main/database/sql/v03-revision-009-creation-author-identity.sql?raw';
import { ensureUserProfileIdentity, hasUserProfileIdentity } from '@/main/database/me/user-profile';
import { ensureAuthorRegistry } from '@/main/database/me/author-registry-schema';
import { contentAuthorshipComplete, ensureContentAuthorship } from '@/main/database/me/content-authorship-schema';

export function creationAuthorSchemaComplete(db: Database.Database) {
  return hasUserProfileIdentity(db) && contentAuthorshipComplete(db);
}

export function ensureCreationAuthorSchema(db: Database.Database) {
  if (creationAuthorSchemaComplete(db)) return;
  const columns = columnNames(db, 'creation_items');
  if (!columns.has('author_name')) db.exec(sql);
  const userId = ensureUserProfileIdentity(db);
  // Schema upgrades retain missing authors and legacy names without assigning
  // ownership. Only an explicit author selection may bind an existing creation.
  if (!columns.has('author_id')) db.exec(identitySql);
  ensureAuthorRegistry(db, userId);
  ensureContentAuthorship(db);
}

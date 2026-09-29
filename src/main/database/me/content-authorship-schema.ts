import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-009-content-authorship.sql?raw';
import { migrateLegacyCredits, migrateRevisionContexts } from '@/main/database/me/authorship-legacy-migration';
import { initializeContentAuthors } from '@/main/database/me/content-authorship';

const marker = 'content-authorship.v1';
/** Desktop calls this before opening the upgrade transaction; SQLite includes uncheckpointed WAL pages. */
export async function backupContentAuthorshipUpgrade(db: Database.Database) {
  if (db.name === ':memory:' || !tableNames(db).has('creation_items') || contentAuthorshipComplete(db)) return null;
  const destination = `${db.name}.before-authorship-${randomUUID()}.sqlite3`;
  await db.backup(destination, { progress: () => 128 });
  return destination;
}

export function contentAuthorshipComplete(db: Database.Database) {
  const tables = tableNames(db);
  return (
    [
      'content_authorships',
      'content_authors',
      'content_authorship_legacy',
      'article_revision_context',
      'authorship_migration_evidence',
    ].every((name) => tables.has(name)) &&
    columnNames(db, 'creation_authors').has('application') &&
    typeof db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(marker) === 'string'
  );
}

/** The schema owner runs this in its upgrade transaction, including existing development revision 9 databases. */
export function ensureContentAuthorship(db: Database.Database) {
  if (contentAuthorshipComplete(db)) return;
  db.exec(sql);
  db.prepare(
    "UPDATE creation_authors SET kind='HUMAN' WHERE id=(SELECT value FROM app_meta WHERE key='user_profile_id')",
  ).run();
  const initial = migrateRevisionContexts(db);
  migrateLegacyCredits(db, initial);
  for (const [id, authors] of initial) initializeContentAuthors(db, { kind: 'ARTICLE', id }, authors);
  db.exec(`ALTER TABLE creation_items DROP COLUMN author_id;
    ALTER TABLE creation_items DROP COLUMN author_name;
    ALTER TABLE creation_items DROP COLUMN author_revision;
    ALTER TABLE article_revisions DROP COLUMN provenance_json;`);
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(marker, new Date().toISOString());
}

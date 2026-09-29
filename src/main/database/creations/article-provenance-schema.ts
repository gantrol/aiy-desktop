import type Database from 'better-sqlite3';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';

export function articleProvenanceShape(db: Database.Database) {
  return (
    tableNames(db).has('article_revision_context') ||
    (tableNames(db).has('article_revisions') && columnNames(db, 'article_revisions').has('provenance_json'))
  );
}

/** Nullable metadata extends the pending revision 8; released revisions remain immutable. */
export function ensureArticleProvenance(db: Database.Database) {
  if (!articleProvenanceShape(db)) db.exec('ALTER TABLE article_revisions ADD COLUMN provenance_json TEXT');
}

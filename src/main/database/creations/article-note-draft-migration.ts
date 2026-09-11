import type Database from 'better-sqlite3';
import { plainTextMarkdown } from '@/shared/content-document';

/** Convert legacy plain-text checkpoints without acknowledging or discarding an edit. */
export function migrateArticleNoteDrafts(db: Database.Database) {
  for (const table of ['desktop_note_drafts', 'content_editor_drafts'] as const) {
    let cursor = 0;
    for (;;) {
      const rows = db
        .prepare(`SELECT rowid AS migration_rowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 32`)
        .all(cursor) as {
        migration_rowid: number;
        document_json?: string;
        draft_json?: string;
        text_content?: string;
        instance_id?: string;
        source_id?: string;
        base_hash?: string;
      }[];
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.migration_rowid;
        const draft = JSON.parse(table === 'desktop_note_drafts' ? row.document_json! : row.draft_json!) as {
          text?: string;
          format?: string;
          document?: unknown;
          expectedContentHash?: string;
          expectedRevisionId?: string;
        };
        const text = table === 'desktop_note_drafts' ? row.text_content! : draft.text!;
        if (!draft.format && !draft.document) {
          draft.format = 'markdown';
          if (table === 'desktop_note_drafts') row.text_content = plainTextMarkdown(text);
          else draft.text = plainTextMarkdown(text);
        }
        const sourceId =
          table === 'desktop_note_drafts'
            ? (
                db.prepare('SELECT stash_id FROM desktop_note_instances WHERE id=?').get(row.instance_id) as {
                  stash_id: string;
                }
              ).stash_id
            : row.source_id!;
        const revision = db
          .prepare(
            'SELECT id FROM article_revisions WHERE article_id=? AND content_hash=? ORDER BY revision_no DESC LIMIT 1',
          )
          .get(sourceId, row.base_hash ?? draft.expectedContentHash) as { id: string } | undefined;
        if (revision) draft.expectedRevisionId = revision.id;
        if (table === 'desktop_note_drafts')
          db.prepare('UPDATE desktop_note_drafts SET document_json=?,text_content=? WHERE rowid=?').run(
            JSON.stringify(draft),
            row.text_content,
            cursor,
          );
        else
          db.prepare('UPDATE content_editor_drafts SET draft_json=? WHERE rowid=?').run(JSON.stringify(draft), cursor);
      }
    }
  }
}

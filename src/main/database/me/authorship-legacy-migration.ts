import type Database from 'better-sqlite3';
import { contentProvenanceSchema, type ContentAuthor } from '@/shared/contracts/content-provenance';
import type { AuthorSummary } from '@/shared/contracts/authorship';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import { resolveDeclaredAuthor, createAuthorIdentity } from '@/main/database/me/author-identities';
import { saveRevisionContext } from '@/main/database/creations/article-write-context';
import { initializeContentAuthors } from '@/main/database/me/content-authorship';

const migrationBatchSize = 128;

type LegacyRevision = {
  id: string;
  article_id: string;
  revision_no: number;
  provenance_json: string | null;
};

// Finish each bounded read before yielding: migration writes cannot run while a SQLite iterator is active.
function* legacyRevisions(db: Database.Database) {
  const query = db.prepare(`SELECT id,article_id,revision_no,provenance_json FROM article_revisions
    WHERE (article_id,revision_no) > (?,?) ORDER BY article_id,revision_no LIMIT ?`);
  let articleId = '';
  let revisionNo = 0;
  while (true) {
    const rows = query.all(articleId, revisionNo, migrationBatchSize) as LegacyRevision[];
    if (!rows.length) return;
    yield* rows;
    const last = rows[rows.length - 1];
    articleId = last.article_id;
    revisionNo = last.revision_no;
  }
}

export function preserveAuthorshipEvidence(db: Database.Database, scope: string, id: string, payload: unknown) {
  db.prepare('INSERT INTO authorship_migration_evidence(scope_type,scope_id,payload_json) VALUES(?,?,?)').run(
    scope,
    id,
    JSON.stringify(payload),
  );
}

/** Legacy declarations are evidence, not proof that every editor was a credited author. */
export function migrateRevisionContexts(db: Database.Database) {
  const initial = new Map<string, string[]>();
  const declarations = new Map<string, AuthorSummary | null>();
  let currentArticle = '';
  const resolve = (articleId: string, author: ContentAuthor) => {
    const key = `${articleId}:${JSON.stringify(author.kind === 'AI' ? { kind: 'AI', application: author.application } : author)}`;
    if (!declarations.has(key)) declarations.set(key, resolveDeclaredAuthor(db, author));
    return declarations.get(key) ?? null;
  };
  for (const row of legacyRevisions(db)) {
    if (currentArticle !== row.article_id) {
      declarations.clear();
      currentArticle = row.article_id;
    }
    if (row.provenance_json == null) continue;
    preserveAuthorshipEvidence(db, 'ARTICLE_REVISION', row.id, row.provenance_json);
    let raw: unknown;
    try {
      raw = JSON.parse(row.provenance_json);
    } catch {
      continue;
    }
    const parsed = contentProvenanceSchema.safeParse(raw);
    if (!parsed.success) continue;
    const value = parsed.data;
    const writer = resolve(row.article_id, value.writer);
    saveRevisionContext(db, row.id, {
      writer,
      entry: value.entry,
      operation: value.operation,
      sources: value.sources,
      requestId: value.requestId,
      batchId: value.batchId,
      baseRevisionId: value.baseRevisionId,
      ...(value.writer.kind === 'AI'
        ? {
            agentId: value.writer.agentId,
            model: value.writer.model,
            threadId: value.writer.threadId,
          }
        : {}),
    });
    if (row.revision_no === 1)
      initial.set(row.article_id, [
        ...new Set(
          value.authors.flatMap((author) => {
            const identity = resolve(row.article_id, author);
            return identity ? [identity.id] : [];
          }),
        ),
      ]);
  }
  return initial;
}

type LegacyItem = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_revision: number;
};

function* legacyItems(db: Database.Database) {
  const query = db.prepare(`SELECT id,author_id,author_name,author_revision FROM creation_items
    WHERE id > ? ORDER BY id LIMIT ?`);
  let itemId = '';
  while (true) {
    const rows = query.all(itemId, migrationBatchSize) as LegacyItem[];
    if (!rows.length) return;
    yield* rows;
    itemId = rows[rows.length - 1].id;
  }
}

export function migrateLegacyCredits(db: Database.Database, initial: Map<string, string[]>) {
  const currentUser = String(db.prepare("SELECT value FROM app_meta WHERE key='user_profile_id'").pluck().get());
  const forms = db.prepare(
    'SELECT entity_type kind,entity_id id FROM creation_forms WHERE creation_item_id=? AND deleted_at IS NULL',
  );
  const chosen = db.prepare(`SELECT payload_json FROM change_events
    WHERE entity_type='CREATION_ITEM' AND entity_id=? AND operation='SET_AUTHOR' ORDER BY rowid DESC LIMIT 1`);
  const cliCreation = db.prepare(`SELECT 1 FROM change_events WHERE entity_type='ARTICLE' AND entity_id=?
    AND operation='CREATE' AND json_extract(payload_json,'$.provenance.entry')='CLI' LIMIT 1`);
  for (const item of legacyItems(db)) {
    preserveAuthorshipEvidence(db, 'CREATION_ITEM', item.id, item);
    const targets = forms.all(item.id) as CreationFormEntityRef[];
    const unique = [...new Map(targets.map((target) => [`${target.kind}:${target.id}`, target])).values()];
    const manuallyAssigned = Boolean(chosen.get(item.id));
    let authorId = item.author_id;
    if (authorId && !db.prepare('SELECT 1 FROM creation_authors WHERE id=?').get(authorId)) authorId = null;
    if (!authorId && item.author_name?.trim()) authorId = createAuthorIdentity(db, item.author_name.trim()).id;
    for (const target of unique) {
      const declared = target.kind === 'ARTICLE' ? initial.get(target.id) : undefined;
      const defaultCliCredit =
        !manuallyAssigned &&
        item.author_id === currentUser &&
        target.kind === 'ARTICLE' &&
        Boolean(cliCreation.get(target.id));
      const ids =
        manuallyAssigned && !authorId
          ? []
          : manuallyAssigned && unique.length === 1
            ? [authorId!]
            : declared?.length
              ? declared
              : unique.length === 1 && authorId && !defaultCliCredit
                ? [authorId]
                : [];
      initializeContentAuthors(db, target, ids);
      db.prepare('UPDATE content_authorships SET revision=? WHERE target_type=? AND target_id=?').run(
        item.author_revision,
        target.kind,
        target.id,
      );
      if (unique.length > 1 && authorId && !ids.includes(authorId))
        db.prepare(
          'INSERT OR IGNORE INTO content_authorship_legacy(target_type,target_id,author_id) VALUES(?,?,?)',
        ).run(target.kind, target.id, authorId);
    }
  }
}

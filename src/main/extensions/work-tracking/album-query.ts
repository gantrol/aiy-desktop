import type { LibraryDatabase } from '@/main/database';
import type { ContentProvenance } from '@/shared/contracts/content-provenance';
import { provenanceV1 } from '@/main/agent/content-provenance-v1';
import { contentAuthorsMany } from '@/main/database/me/content-authorship';
import { revisionContexts } from '@/main/database/creations/article-write-context';
import type { AgentWorkList } from '@/shared/contracts/agent-work';
import type { WorkSnapshot } from '@/shared/contracts/work-tracking';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';

export function listWorkAlbum(database: LibraryDatabase, input: AgentWorkList, snapshot: WorkSnapshot) {
  const matches = database.db
    .prepare(
      `SELECT id, title FROM albums WHERE deleted_at IS NULL AND archived_at IS NULL AND ${input.albumId ? 'id' : 'title'}=? LIMIT 2`,
    )
    .all(input.albumId ?? input.albumTitle) as { id: string; title: string }[];
  if (matches.length !== 1) throw new WorkTrackingError(matches.length ? 'invalidInput' : 'sourceUnavailable');
  const album = matches[0]!;
  const unavailable = database.db
    .prepare(
      `WITH RECURSIVE lineage(id, archived_at, deleted_at) AS (
    SELECT id, archived_at, deleted_at FROM albums WHERE id=?
    UNION SELECT parent.id, parent.archived_at, parent.deleted_at FROM lineage child
    JOIN album_members member ON member.target_type='ALBUM' AND member.target_id=child.id AND member.deleted_at IS NULL
    JOIN albums parent ON parent.id=member.album_id
  ) SELECT 1 FROM lineage WHERE archived_at IS NOT NULL OR deleted_at IS NOT NULL LIMIT 1`,
    )
    .get(album.id);
  if (unavailable) throw new WorkTrackingError('sourceUnavailable');
  const membership = `FROM creation_items item JOIN album_members member
    ON member.target_type='CREATION_ITEM' AND member.target_id=item.id
    WHERE member.album_id=? AND member.deleted_at IS NULL AND item.deleted_at IS NULL AND item.archived_at IS NULL`;
  const total = Number(database.db.prepare(`SELECT COUNT(DISTINCT item.id) ${membership}`).pluck().get(album.id));
  const items = database.db
    .prepare(
      `SELECT DISTINCT item.id, item.primary_form_id, item.updated_at ${membership}
    ORDER BY item.updated_at DESC, item.id DESC LIMIT ? OFFSET ?`,
    )
    .all(album.id, input.limit, input.offset) as { id: string; primary_form_id: string | null }[];
  // Current article revisions remain unpacked. Only title metadata crosses the SQL boundary.
  const forms = database.db
    .prepare(
      `SELECT form.creation_item_id AS itemId, form.id AS formId, article.id AS articleId,
    COALESCE(json_extract(revision.content_json, '$.title'), '') AS title, revision.id AS revisionId
    FROM creation_forms form JOIN json_each(?) selected ON selected.value=form.creation_item_id
    JOIN articles article ON article.id=form.entity_id AND article.deleted_at IS NULL AND article.status='ACTIVE'
    JOIN article_revisions revision ON revision.id=article.current_revision_id
    WHERE form.entity_type='ARTICLE' AND form.deleted_at IS NULL ORDER BY form.sort_order, form.id`,
    )
    .all(JSON.stringify(items.map((item) => item.id))) as {
    itemId: string;
    formId: string;
    articleId: string;
    title: string;
    revisionId: string;
  }[];
  const authors = contentAuthorsMany(
    database.db,
    forms.map((form) => ({ kind: 'ARTICLE', id: form.articleId })),
  );
  const contexts = revisionContexts(
    database.db,
    forms.map((form) => form.revisionId),
  );
  const byItem = new Map<
    string,
    { formId: string; articleId: string; title: string; provenance?: ContentProvenance }[]
  >();
  for (const { itemId, revisionId, ...source } of forms) {
    const entries = byItem.get(itemId) ?? [];
    entries.push({
      ...source,
      provenance: provenanceV1(authors.get('ARTICLE:' + source.articleId) ?? [], contexts.get(revisionId)),
    });
    byItem.set(itemId, entries);
  }
  const tracked = new Map(snapshot.items.map((item) => [item.id, item]));
  return {
    spaceId: input.spaceId,
    album,
    revision: snapshot.revision,
    total,
    nextOffset: input.offset + items.length < total ? input.offset + items.length : null,
    rows: items.map((entry) => {
      const item = tracked.get(entry.id) ?? null;
      const sources = byItem.get(entry.id) ?? [];
      const preferred = sources.find((source) => source.formId === (item?.descriptionFormId ?? entry.primary_form_id));
      return {
        creationItemId: entry.id,
        title: preferred?.title ?? sources[0]?.title ?? '',
        descriptionFormId: preferred?.formId ?? (sources.length === 1 ? sources[0]!.formId : null),
        sources,
        item,
      };
    }),
  };
}

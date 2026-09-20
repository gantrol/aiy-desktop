import type Database from 'better-sqlite3';

type Identity = { kind: string; id: string };
type Metadata = { title: string; revisionId?: string };
const key = ({ kind, id }: Identity) => `${kind}:${id}`;

/** Resolve a bounded set of labels without hydrating member bodies, assets or descendants. */
export function referenceMetadata(db: Database.Database, identities: readonly Identity[]) {
  const result = new Map<string, Metadata>();
  const unique = [...new Map(identities.map((identity) => [key(identity), identity])).values()];
  for (let offset = 0; offset < unique.length; offset += 200) {
    const batch = unique.slice(offset, offset + 200);
    const rows = db
      .prepare(
        `
      WITH targets(kind,id) AS (VALUES ${batch.map(() => '(?,?)').join(',')}),
      ranked_forms AS (
        SELECT target.id AS owner_id, form.entity_type, form.entity_id,
          ROW_NUMBER() OVER (PARTITION BY target.id ORDER BY
            CASE WHEN form.id = item.primary_form_id THEN 0 ELSE 1 END, form.sort_order, form.id) AS rank
        FROM targets target
        JOIN creation_items item ON target.kind = 'CREATION_ITEM' AND item.id = target.id
        JOIN creation_forms form ON form.creation_item_id = item.id AND form.deleted_at IS NULL
      ), resolved AS (
        SELECT target.kind, target.id,
          COALESCE(form.entity_type, target.kind) AS entity_kind,
          COALESCE(form.entity_id, target.id) AS entity_id
        FROM targets target LEFT JOIN ranked_forms form ON form.owner_id = target.id
          AND target.kind = 'CREATION_ITEM' AND form.rank = 1
      )
      SELECT target.kind, target.id,
        COALESCE(NULLIF(json_extract(article_revision.content_json, '$.title'), ''),
          NULLIF(substr(json_extract(article_revision.content_json, '$.markdown'), 1, 160), ''),
          NULLIF(json_extract(post_revision.content_json, '$.title'), ''),
          NULLIF(substr(json_extract(post_revision.content_json, '$.body'), 1, 160), ''),
          album.title, video.title, gif.title, series.title, breakdown.title,
          json_extract(suite_revision.content_json, '$.title'), visual_series.title,
          NULLIF(substr(material.text_content, 1, 160), ''), target.id) AS title,
        CASE WHEN target.kind = 'CREATION_ITEM' THEN NULL ELSE
          COALESCE(article.current_revision_id, post.current_revision_id, suite.current_revision_id,
            CAST(gif.revision AS TEXT), series.current_version_id, visual_series.current_version_id,
            material.content_hash) END AS revision_id
      FROM resolved target
      LEFT JOIN articles article ON target.entity_kind IN ('ARTICLE','INSPIRATION_STASH')
        AND article.id = target.entity_id AND article.deleted_at IS NULL
      LEFT JOIN article_revisions article_revision ON article_revision.id = article.current_revision_id
      LEFT JOIN social_post_drafts post ON target.entity_kind = 'SOCIAL_POST' AND post.id = target.entity_id
        AND post.deleted_at IS NULL
      LEFT JOIN social_post_revisions post_revision ON post_revision.id = post.current_revision_id
      LEFT JOIN albums album ON target.entity_kind = 'ALBUM' AND album.id = target.entity_id AND album.deleted_at IS NULL
      LEFT JOIN documents video ON target.entity_kind = 'VIDEO_DOCUMENT' AND video.id = target.entity_id AND video.deleted_at IS NULL
      LEFT JOIN gif_documents gif ON target.entity_kind = 'GIF_DOCUMENT' AND gif.id = target.entity_id
      LEFT JOIN prompt_series series ON target.entity_kind = 'PROMPT_SERIES' AND series.id = target.entity_id AND series.deleted_at IS NULL
      LEFT JOIN image_breakdowns breakdown ON target.entity_kind = 'IMAGE_BREAKDOWN' AND breakdown.id = target.entity_id AND breakdown.deleted_at IS NULL
      LEFT JOIN evaluation_suites suite ON target.entity_kind = 'EVALUATION_SUITE' AND suite.id = target.entity_id AND suite.deleted_at IS NULL
      LEFT JOIN evaluation_suite_revisions suite_revision ON suite_revision.id = suite.current_revision_id
      LEFT JOIN derived_visuals visual ON target.entity_kind = 'DERIVED_VISUAL' AND visual.id = target.entity_id
      LEFT JOIN prompt_series visual_series ON visual_series.id = visual.prompt_series_id AND visual_series.deleted_at IS NULL
      LEFT JOIN materials material ON target.entity_kind = 'MATERIAL' AND material.id = target.entity_id AND material.deleted_at IS NULL
    `,
      )
      .all(...batch.flatMap(({ kind, id }) => [kind, id])) as {
      kind: string;
      id: string;
      title: string;
      revision_id: string | null;
    }[];
    for (const row of rows)
      result.set(key(row), { title: row.title, ...(row.revision_id ? { revisionId: row.revision_id } : {}) });
  }
  return (identity: Identity): Metadata => result.get(key(identity)) ?? { title: identity.id };
}

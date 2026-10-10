import type Database from 'better-sqlite3';
import { migrateSocialPostReadableContent } from '@/main/database/creations/social-post-readable-content-migration';

/** Rebind live ownership; immutable reference/delivery snapshots retain their captured source identity. */
export function migrateSocialPostRelations(db: Database.Database) {
  if (
    db
      .prepare(
        `SELECT 1 FROM content_revision_elements element JOIN creation_forms form ON form.id=element.form_id
    LEFT JOIN article_revisions revision ON revision.id=element.revision_id AND revision.article_id=form.entity_id
    WHERE form.entity_type='SOCIAL_POST' AND revision.id IS NULL LIMIT 1`,
      )
      .get()
  )
    throw new Error('Social post comment revision is missing');
  db.exec(`INSERT INTO article_elements(id,article_id,created_at,updated_at)
    SELECT element.element_id,form.entity_id,MIN(revision.created_at),MAX(revision.created_at)
    FROM content_revision_elements element JOIN creation_forms form ON form.id=element.form_id
    JOIN article_revisions revision ON revision.id=element.revision_id
    WHERE form.entity_type='SOCIAL_POST' GROUP BY form.entity_id,element.element_id;
    INSERT INTO article_revision_elements(revision_id,article_id,element_id,block_index,node_type,text_fingerprint,preview)
    SELECT element.revision_id,form.entity_id,element.element_id,element.block_index,element.node_type,element.text_fingerprint,element.preview
    FROM content_revision_elements element JOIN creation_forms form ON form.id=element.form_id
    JOIN article_revisions revision ON revision.id=element.revision_id WHERE form.entity_type='SOCIAL_POST';`);
  const columns = [
    'id',
    'created_revision_id',
    'status',
    'anchor_kind',
    'start_element_id',
    'start_offset',
    'end_element_id',
    'end_offset',
    'start_block_index',
    'end_block_index',
    'exact_quote',
    'prefix',
    'suffix',
    'created_preview',
    'body',
    'author_id',
    'created_at',
    'updated_at',
    'resolved_at',
  ];
  db.exec(`INSERT INTO article_comments(article_id,${columns.join(',')})
    SELECT form.entity_id,${columns.map((column) => `comment.${column}`).join(',')}
    FROM content_comments comment JOIN creation_forms form ON form.id=comment.form_id WHERE form.entity_type='SOCIAL_POST';
    INSERT INTO article_comment_replies SELECT reply.* FROM content_comment_replies reply
      JOIN article_comments comment ON comment.id=reply.comment_id
      JOIN article_legacy_posts legacy ON legacy.article_id=comment.article_id;
    DELETE FROM content_comment_replies WHERE comment_id IN (
      SELECT comment.id FROM content_comments comment JOIN creation_forms form ON form.id=comment.form_id
      WHERE form.entity_type='SOCIAL_POST');
    DELETE FROM content_comments WHERE form_id IN (SELECT id FROM creation_forms WHERE entity_type='SOCIAL_POST');
    DELETE FROM content_revision_elements WHERE form_id IN (SELECT id FROM creation_forms WHERE entity_type='SOCIAL_POST');
    UPDATE creation_forms SET role='ARTICLE',entity_type='ARTICLE' WHERE entity_type='SOCIAL_POST';
    UPDATE creation_forms SET role='ARTICLE_HEADER' WHERE role='SOCIAL_POST_COVER';
    UPDATE derived_visuals SET role='ARTICLE_HEADER',article_id=social_post_id,
      article_revision_id=social_post_revision_id,social_post_id=NULL,social_post_revision_id=NULL
      WHERE social_post_id IS NOT NULL;
    UPDATE derived_visual_operations SET target_kind='ARTICLE' WHERE target_kind='SOCIAL_POST';
    UPDATE content_block_references SET source_kind='ARTICLE' WHERE source_kind='SOCIAL_POST';
    UPDATE publishing_mask_drafts SET article_id=social_post_id,social_post_id=NULL,
      draft_json=json_set(draft_json,'$.source.kind','ARTICLE') WHERE social_post_id IS NOT NULL;
    UPDATE content_authorships SET target_type='ARTICLE' WHERE target_type='SOCIAL_POST';
    UPDATE content_authors SET target_type='ARTICLE' WHERE target_type='SOCIAL_POST';
    UPDATE content_authorship_legacy SET target_type='ARTICLE' WHERE target_type='SOCIAL_POST';
    UPDATE content_lifecycle_batches SET root_entity_type='ARTICLE' WHERE root_entity_type='SOCIAL_POST';
    UPDATE content_lifecycle_batches SET root_subtype='ARTICLE' WHERE root_subtype='SOCIAL_POST';
    UPDATE content_lifecycle_batch_members SET entity_type='ARTICLE' WHERE entity_type='SOCIAL_POST';
    UPDATE content_lifecycle_batch_members SET parent_entity_type='ARTICLE' WHERE parent_entity_type='SOCIAL_POST';
    UPDATE content_lifecycle_batch_members SET subtype='ARTICLE' WHERE subtype='SOCIAL_POST';
    INSERT INTO desktop_note_instances(id,stash_id,color,icon,created_at,updated_at)
      SELECT 'article:' || substr(id,5),source_id,color,icon,datetime('now'),datetime('now')
      FROM desktop_content_pins WHERE source_kind='SOCIAL_POST';
    UPDATE desktop_petal_memberships SET instance_id='article:' || substr(instance_id,5)
      WHERE instance_id IN (SELECT id FROM desktop_content_pins WHERE source_kind='SOCIAL_POST');
    DELETE FROM desktop_content_pins WHERE source_kind='SOCIAL_POST';`);
  db.exec(`CREATE TABLE gif_frame_groups_article (
      document_id TEXT NOT NULL REFERENCES gif_documents(id),
      candidate_id TEXT NOT NULL REFERENCES gif_generation_runs(id),
      post_id TEXT NOT NULL REFERENCES articles(id), PRIMARY KEY(document_id,candidate_id));
    INSERT INTO gif_frame_groups_article SELECT * FROM gif_frame_groups;
    DROP TABLE gif_frame_groups;
    ALTER TABLE gif_frame_groups_article RENAME TO gif_frame_groups;`);
  migrateSocialPostReadableContent(db);
}

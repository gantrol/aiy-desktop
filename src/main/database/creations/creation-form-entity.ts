import type Database from 'better-sqlite3';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';

/** Concrete content owns its lifecycle even while an old form binding still exists. */
export function creationEntityExists(db: Database.Database, entity: CreationFormEntityRef) {
  const table = {
    GIF_DOCUMENT: 'gif_documents',
    PROMPT_SERIES: 'prompt_series',
    IMAGE_BREAKDOWN: 'image_breakdowns',
    INSPIRATION_STASH: 'inspiration_stashes',
    SOCIAL_POST: 'social_post_drafts',
    ARTICLE: 'articles',
    VIDEO_DOCUMENT: 'documents',
    EVALUATION_SUITE: 'evaluation_suites',
    DERIVED_VISUAL: 'derived_visuals',
  }[entity.kind];
  const deletionPredicate = entity.kind === 'DERIVED_VISUAL' ? '' : ' AND deleted_at IS NULL';
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id=?${deletionPredicate}`).get(entity.id));
}

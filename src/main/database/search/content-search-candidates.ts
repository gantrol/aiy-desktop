import type Database from 'better-sqlite3';
import type { ContentSource } from '@/shared/contracts/content-source';

export interface ContentSearchCandidate {
  key: string;
  kind: Exclude<ContentSource['kind'], 'INSPIRATION_STASH'>;
  id: string;
  branch_id: string | null;
  branch_role: string | null;
  revision_id: string | null;
  updated_at: string;
  stamp: string;
}

/** Current identities and lifecycle are authoritative; the derived index never is. */
export function installContentSearchView(db: Database.Database) {
  db.exec(`CREATE TEMP VIEW IF NOT EXISTS aiy_search_current AS
    SELECT json_array('ARTICLE', a.id) AS key, 'ARTICLE' AS kind, a.id, NULL AS branch_id,
      NULL AS branch_role, r.id AS revision_id, a.updated_at,
      json_array(r.id, a.updated_at) AS stamp
    FROM main.articles a LEFT JOIN main.article_revisions r
      ON r.id = a.current_revision_id AND r.article_id = a.id
    WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE'
    UNION ALL
    SELECT json_array('SOCIAL_POST', p.id), 'SOCIAL_POST', p.id, NULL, NULL, r.id, p.updated_at,
      json_array(r.id, p.updated_at)
    FROM main.social_post_drafts p LEFT JOIN main.social_post_revisions r
      ON r.id = p.current_revision_id AND r.draft_id = p.id
    WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
    UNION ALL
    SELECT json_array('VIDEO_DOCUMENT', d.id, b.id), 'VIDEO_DOCUMENT', d.id, b.id, b.role,
      r.id, d.updated_at, json_array(r.id, d.updated_at, d.title, b.updated_at, b.role)
    FROM main.documents d JOIN main.document_branches b ON b.document_id = d.id
    JOIN main.document_drafts draft ON draft.branch_id = b.id AND draft.deleted_at IS NULL
    JOIN main.document_draft_revisions r ON r.id = (
      SELECT latest.id FROM main.document_draft_revisions latest
      WHERE latest.draft_id = draft.id ORDER BY latest.revision_no DESC, latest.id DESC LIMIT 1
    )
    WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND b.deleted_at IS NULL`);
}

export function candidateSource(candidate: ContentSearchCandidate): ContentSource {
  return {
    kind: candidate.kind,
    id: candidate.id,
    ...(candidate.branch_id ? { branchId: candidate.branch_id } : {}),
    ...(candidate.revision_id ? { revisionId: candidate.revision_id } : {}),
  };
}

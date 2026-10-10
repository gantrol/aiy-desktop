import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { setImmediate } from 'node:timers/promises';

export interface VideoSearchSource {
  id: string;
  hash: string;
  assetId: string;
  relativePath: string;
  title: string;
  durationMs: number;
  revision: string;
}

/** Read a bounded page of identities, without loading document bodies or media. */
function readPage(db: Database.Database, ids: string[] | undefined, after = ''): VideoSearchSource[] {
  if (ids && !ids.length) return [];
  const rows = db
    .prepare(
      `SELECT d.id, a.object_hash AS hash, a.id AS assetId,
    a.relative_path AS relativePath, coalesce(nullif(d.title,''), mdata.display_name, mdata.original_name, d.id) AS title,
    v.duration_ms AS durationMs,
    (SELECT group_concat(identity, '|') FROM (
      SELECT b.id || ':' || coalesce((SELECT r.id FROM document_draft_revisions r
        WHERE r.draft_id = draft.id ORDER BY r.revision_no DESC LIMIT 1), '') AS identity
      FROM document_branches b JOIN document_drafts draft ON draft.branch_id = b.id AND draft.deleted_at IS NULL
      WHERE b.document_id = d.id AND b.deleted_at IS NULL ORDER BY b.id
    )) AS revisions
    FROM documents d
    JOIN document_source_relations s ON s.document_id = d.id AND s.role = 'PRIMARY_VIDEO'
    JOIN materials m ON m.id = s.material_id AND m.kind = 'VIDEO' AND m.deleted_at IS NULL AND m.archived_at IS NULL
    JOIN image_assets a ON a.id = m.image_asset_id AND a.deleted_at IS NULL
    JOIN video_assets v ON v.image_asset_id = a.id
    LEFT JOIN external_material_metadata mdata ON mdata.material_id = m.id
    WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND d.id > @after
      ${ids ? 'AND d.id IN (SELECT value FROM json_each(@ids))' : ''}
    ORDER BY d.id LIMIT 128`,
    )
    .all(ids ? { after, ids: JSON.stringify(ids) } : { after }) as (Omit<VideoSearchSource, 'revision'> & {
    revisions: string | null;
  })[];
  return rows.map(({ revisions, ...row }) => ({
    ...row,
    revision: createHash('sha256')
      .update(JSON.stringify([row.hash, revisions, row.title, row.durationMs]))
      .digest('hex'),
  }));
}

/** Main-process callers only validate an explicit result page or open one source. */
export function readVideoSearchSources(db: Database.Database, ids: string[]): VideoSearchSource[] {
  if (ids.length > 128) throw new Error('UNAVAILABLE');
  return readPage(db, ids);
}

/** Whole-space enumeration stays in the worker, with cancellation between pages. */
export async function readVideoSearchScope(db: Database.Database, ids: string[] | undefined, check: () => void) {
  if (ids) return readVideoSearchSources(db, ids);
  const sources: VideoSearchSource[] = [];
  let after = '';
  for (;;) {
    check();
    const page = readPage(db, undefined, after);
    sources.push(...page);
    if (page.length < 128) return sources;
    after = page.at(-1)!.id;
    await setImmediate();
  }
}

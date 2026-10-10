import type Database from 'better-sqlite3';
import { creationOutputCandidatesSql } from '@/main/database/assets/gallery-creation-relationships-sql';
import type { ImageSearchItem } from '@/shared/contracts/image-search';

export interface ImageSearchSource {
  id: string;
  hash: string;
  title: string;
  bytes: number;
  mime: string;
  titleKind: ImageSearchItem['titleKind'];
  createdAt: string;
  aliases: string[];
}

function meaningfulName(name: string, id: string) {
  const value = name.trim();
  const stem = value.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return value && stem !== id && !/^(?:[0-9a-f-]{20,}|[0-9A-HJKMNP-TV-Z]{26})$/i.test(stem) ? value : '';
}

function addTitle(source: ImageSearchSource, name: string, kind: ImageSearchItem['titleKind']) {
  const value = name.trim();
  if (value && !source.aliases.includes(value)) source.aliases.push(value);
  const title = meaningfulName(value, source.id);
  if (!source.title && title) {
    source.title = title;
    source.titleKind = kind;
  }
}

/** Metadata only. The asset repository resolves file paths after the worker asks for a bounded batch. */
export function readImageSearchSources(
  db: Database.Database,
  visible: string,
  after: string,
  ids?: string[],
  includeTitles = true,
) {
  const rows = db
    .prepare(
      `SELECT asset.id, asset.object_hash AS hash, asset.byte_size AS bytes,
    asset.mime_type AS mime, asset.created_at AS createdAt
    FROM image_assets asset WHERE asset.deleted_at IS NULL AND asset.mime_type LIKE 'image/%'
      AND (${visible}) AND asset.id>?
      ${ids ? 'AND asset.id IN (SELECT value FROM json_each(?))' : ''}
    ORDER BY asset.id LIMIT 128`,
    )
    .all(after, ...(ids ? [JSON.stringify(ids)] : [])) as Omit<ImageSearchSource, 'title' | 'titleKind' | 'aliases'>[];
  if (!rows.length) return [];
  const sources = new Map<string, ImageSearchSource>(
    rows.map((row) => [
      row.id,
      {
        ...row,
        title: '',
        titleKind: 'UNTITLED',
        aliases: [],
      },
    ]),
  );
  if (!includeTitles) return [...sources.values()];
  const selected = JSON.stringify(rows.map((row) => row.id));
  const names = db
    .prepare(
      `SELECT material.image_asset_id AS id,
    metadata.display_name AS displayName, metadata.original_name AS originalName
    FROM materials material JOIN external_material_metadata metadata ON metadata.material_id=material.id
    WHERE material.image_asset_id IN (SELECT value FROM json_each(?))
      AND material.deleted_at IS NULL AND material.archived_at IS NULL
    ORDER BY metadata.updated_at DESC, material.id`,
    )
    .all(selected) as {
    id: string;
    displayName: string | null;
    originalName: string | null;
  }[];
  for (const row of names) {
    const source = sources.get(row.id)!;
    addTitle(source, row.displayName ?? '', 'NAME');
    addTitle(source, row.originalName ?? '', 'NAME');
  }
  // Reuse gallery output visibility, including failed/excluded outputs, in a set query per bounded batch.
  const creations = db
    .prepare(
      `SELECT asset_id AS id, title FROM (${creationOutputCandidatesSql})
    WHERE asset_id IN (SELECT value FROM json_each(?))
      AND series_deleted_at IS NULL AND series_archived_at IS NULL
    ORDER BY relation_created_at DESC, relation_key DESC`,
    )
    .all(selected) as { id: string; title: string }[];
  for (const row of creations) addTitle(sources.get(row.id)!, row.title, 'CREATION');
  const terms = db
    .prepare(
      `SELECT relationship.asset_id AS id, revision.title FROM (
      SELECT image_asset_id AS asset_id, term_id FROM term_media_links WHERE deleted_at IS NULL
      UNION SELECT image_asset_id AS asset_id, term_id FROM term_evidence WHERE image_asset_id IS NOT NULL
    ) relationship JOIN terms term ON term.id=relationship.term_id
    JOIN term_revisions revision ON revision.id=term.current_revision_id
    WHERE relationship.asset_id IN (SELECT value FROM json_each(?)) AND term.archived_at IS NULL
    ORDER BY term.id`,
    )
    .all(selected) as { id: string; title: string }[];
  for (const row of terms) addTitle(sources.get(row.id)!, row.title, 'DICTIONARY');
  return [...sources.values()];
}

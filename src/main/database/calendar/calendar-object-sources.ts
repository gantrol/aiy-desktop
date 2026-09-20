import type Database from 'better-sqlite3';
import type { CalendarEntityRef } from '@/shared/contracts/calendar';

interface ParentSource {
  from: string;
  key: string;
  type: string;
  id: string;
  available?: string;
  order?: string;
}

const parent = (from: string, key: string, type: string, id: string, available?: string): ParentSource => ({
  from,
  key,
  type: `'${type}'`,
  id,
  available,
});
const scope = (from: string): ParentSource => ({
  from,
  key: 'id',
  type: "CASE scope_kind WHEN 'SERIES' THEN 'PROMPT_SERIES' ELSE 'CREATION_DRAFT' END",
  id: 'scope_id',
});

// One relationship definition serves source navigation and daily object identity.
// Availability only controls navigation: a soft-deleted child's identity is retained.
export const calendarParentSources: Record<string, ParentSource> = {
  ARTICLE_REVISION: parent('article_revisions', 'id', 'ARTICLE', 'article_id'),
  TERM_REVISION: parent('term_revisions', 'id', 'TERM', 'term_id'),
  EVALUATION_SUITE_REVISION: parent('evaluation_suite_revisions', 'id', 'EVALUATION_SUITE', 'suite_id'),
  ARTICLE_COMMENT: parent('article_comments', 'id', 'ARTICLE', 'article_id'),
  ARTICLE_CHECK_RUN: parent('article_check_runs', 'id', 'ARTICLE', 'article_id'),
  ARTICLE_DELIVERY_JOB: parent('article_delivery_jobs', 'id', 'ARTICLE', 'article_id'),
  BROWSER_HANDOFF: { from: 'calendar_handoff_sources', key: 'handoff_id', type: 'source_type', id: 'source_id' },
  CODEX_CONTENT_TASK: parent('codex_content_tasks', 'id', 'ARTICLE', 'stash_id'),
  GIF_GENERATION_RUN: parent('gif_generation_runs', 'id', 'GIF_DOCUMENT', 'document_id'),
  GIF_EXPORT_RUN: parent('gif_export_runs', 'id', 'GIF_DOCUMENT', 'document_id'),
  CONTENT_REFERENCE: { from: 'content_block_references', key: 'id', type: 'source_kind', id: 'source_id' },
  DERIVED_VISUAL: {
    from: 'derived_visuals',
    key: 'id',
    type: "CASE WHEN article_id IS NOT NULL THEN 'ARTICLE' ELSE 'SOCIAL_POST_DRAFT' END",
    id: 'COALESCE(article_id,social_post_id)',
  },
  SOCIAL_POST_REVISION: parent('social_post_revisions', 'id', 'SOCIAL_POST_DRAFT', 'draft_id'),
  PROMPT_VERSION: parent('prompt_versions', 'id', 'PROMPT_SERIES', 'series_id'),
  GENERATION_EDIT_SPEC: parent('prompt_versions', 'id', 'PROMPT_SERIES', 'series_id'),
  CREATION_INPUT_STASH: scope('creation_input_stashes'),
  GENERATION_RUN: parent(
    'generation_runs r JOIN prompt_versions p ON p.id=r.prompt_version_id',
    'r.id',
    'PROMPT_SERIES',
    'p.series_id',
  ),
  CREATION_OUTPUT_IMPORT: parent(
    'creation_output_imports c JOIN image_assets a ON a.id=c.image_asset_id',
    'c.id',
    'PROMPT_SERIES',
    'c.series_id',
    'c.deleted_at IS NULL AND a.deleted_at IS NULL',
  ),
  CREATION_ITEM: {
    from: 'creation_items i LEFT JOIN creation_forms f ON f.id=i.primary_form_id',
    key: 'i.id',
    type: 'f.entity_type',
    id: 'f.entity_id',
    available: 'i.deleted_at IS NULL AND f.deleted_at IS NULL',
  },
  CREATION_FORM: {
    from: 'creation_forms f JOIN creation_items i ON i.id=f.creation_item_id',
    key: 'f.id',
    type: 'f.entity_type',
    id: 'f.entity_id',
    available: 'f.deleted_at IS NULL AND i.deleted_at IS NULL',
  },
  CREATION_ELEMENT: parent('creation_elements', 'id', 'CREATION', 'creation_id', 'deleted_at IS NULL'),
  CREATION_ACTIVITY_EVENT: parent('creation_activity_events', 'id', 'CREATION', 'creation_id'),
  // Membership changes describe the collection, including retained removals.
  ALBUM_MEMBER: parent('album_members', 'id', 'ALBUM', 'album_id'),
  DOCUMENT_BRANCH: parent('document_branches', 'id', 'DOCUMENT', 'document_id', 'deleted_at IS NULL'),
  DOCUMENT_DRAFT: parent('document_drafts', 'id', 'DOCUMENT_BRANCH', 'branch_id', 'deleted_at IS NULL'),
  DOCUMENT_DRAFT_REVISION: parent('document_draft_revisions', 'id', 'DOCUMENT_DRAFT', 'draft_id'),
  DOCUMENT_SOURCE_RELATION: parent('document_source_relations', 'id', 'DOCUMENT', 'document_id'),
  VIDEO_DOCUMENT_GENERATION_RUN: parent('video_document_generation_runs', 'id', 'DOCUMENT', 'document_id'),
  VIDEO_DOCUMENT_TRANSCRIPTION_RUN: parent('video_document_transcription_runs', 'id', 'DOCUMENT', 'document_id'),
  VIDEO_DOCUMENT_TRANSLATION_RUN: parent('video_document_translation_runs', 'id', 'DOCUMENT', 'document_id'),
  TERM_MEDIA_LINK: parent('term_media_links', 'id', 'TERM', 'term_id', 'deleted_at IS NULL'),
  EXTERNAL_MATERIAL_METADATA: parent('external_material_metadata', 'material_id', 'MATERIAL', 'material_id'),
  ANNOTATION: parent('annotations', 'id', 'IMAGE_ASSET', 'image_asset_id'),
  IMAGE_RATING: parent('image_ratings', 'id', 'IMAGE_ASSET', 'image_asset_id', 'deleted_at IS NULL'),
  IMAGE_TRANSFORM: parent('image_transform_runs', 'id', 'IMAGE_ASSET', 'output_asset_id', 'deleted_at IS NULL'),
  MATERIAL_FAVORITE: parent('material_favorites', 'id', 'MATERIAL', 'material_id', 'deleted_at IS NULL'),
  MATERIAL: parent('materials', 'id', 'IMAGE_ASSET', 'image_asset_id', 'deleted_at IS NULL'),
  ASSISTANT_RUN: scope('assistant_runs'),
  ASSISTANT_PROPOSAL: parent('assistant_proposals', 'id', 'ASSISTANT_RUN', 'assistant_run_id'),
  AGENT_TASK: scope('direction_experiment_director_tasks'),
  AGENT_GENERATION_JOB: {
    ...parent(
      'agent_generation_job_runs r JOIN agent_generation_jobs j ON j.id=r.job_id',
      'j.id',
      'GENERATION_RUN',
      'r.run_id',
    ),
    order: 'r.sort_order,r.run_id',
  },
  AGENT_COMMAND: {
    from: 'agent_command_requests',
    key: 'id',
    type: "CASE command WHEN 'ASSET_IMPORT' THEN 'IMAGE_ASSET' ELSE 'AGENT_GENERATION_JOB' END",
    id: "CASE WHEN json_valid(result_json) THEN CASE command WHEN 'ASSET_IMPORT' THEN json_extract(result_json,'$.asset.assetId') WHEN 'DRAFT_PREPARE' THEN json_extract(result_json,'$.draftId') ELSE json_extract(result_json,'$.jobId') END END",
  },
  BACKGROUND_JOB: parent('generation_job_links', 'job_id', 'GENERATION_RUN', 'generation_run_id'),
  STYLE_EXPLORATION_BATCH: scope('style_exploration_batches'),
  STYLE_EXPLORATION_SLOT: parent('style_exploration_slots', 'id', 'STYLE_EXPLORATION_BATCH', 'batch_id'),
  CREATOR_AGENT_TURN: scope('creator_agent_turns'),
  AI_PROCESS: scope('ai_processes'),
  AI_PROCESS_EVENT: parent('ai_process_events', 'id', 'AI_PROCESS', 'process_id'),
  DESKTOP_NOTE_INSTANCE: parent('desktop_note_instances', 'id', 'ARTICLE', 'stash_id'),
  DESKTOP_CONTENT_PIN: { from: 'desktop_content_pins', key: 'id', type: 'source_kind', id: 'source_id' },
  PETAL_MEMBERSHIP: {
    from: 'desktop_petal_memberships m',
    key: 'm.instance_id',
    type: "CASE WHEN EXISTS(SELECT 1 FROM desktop_content_pins p WHERE p.id=m.instance_id) THEN 'DESKTOP_CONTENT_PIN' ELSE 'DESKTOP_NOTE_INSTANCE' END",
    id: 'm.instance_id',
  },
};

export const calendarSourceAliases: Record<string, string> = {
  IMAGE: 'IMAGE_ASSET',
  MATERIAL_ALBUM: 'ALBUM',
  VIDEO_ASSET: 'IMAGE_ASSET',
  SOCIAL_POST: 'SOCIAL_POST_DRAFT',
  SERIES: 'PROMPT_SERIES',
  VIDEO_DOCUMENT: 'DOCUMENT',
  DOCUMENT_THUMBNAIL: 'DOCUMENT',
  INSPIRATION_STASH: 'ARTICLE',
};

export function calendarParentQuery(source: ParentSource, batch: boolean, requireAvailable = !batch) {
  return `SELECT ${source.key} source_id,${source.type} type,${source.id} id FROM ${source.from}
    WHERE ${source.key} ${batch ? 'IN (SELECT value FROM json_each(?))' : '=?'}
    ${requireAvailable && source.available ? `AND ${source.available}` : ''}
    ${source.order ? `ORDER BY ${source.order}` : ''} ${batch ? '' : 'LIMIT 1'}`;
}

const key = (ref: CalendarEntityRef) => JSON.stringify([ref.type, ref.id]);
const normalize = (ref: CalendarEntityRef) => ({ type: calendarSourceAliases[ref.type] ?? ref.type, id: ref.id });

/** Resolve only distinct objects in the requested window, in bounded, set-oriented batches. */
export function calendarActivityObjects(db: Database.Database, refs: CalendarEntityRef[]) {
  const links = new Map<string, CalendarEntityRef | null>();
  let pending = new Map(
    refs.map((ref) => {
      const value = normalize(ref);
      return [key(value), value];
    }),
  );
  for (let depth = 0; pending.size && depth <= 5; depth++) {
    const byType = new Map<string, CalendarEntityRef[]>();
    for (const ref of pending.values()) {
      if (links.has(key(ref))) continue;
      links.set(key(ref), null);
      if (!calendarParentSources[ref.type]) continue;
      const group = byType.get(ref.type) ?? [];
      group.push(ref);
      byType.set(ref.type, group);
    }
    pending = new Map();
    for (const [type, group] of byType) {
      const statement = db.prepare(calendarParentQuery(calendarParentSources[type]!, true));
      for (let offset = 0; offset < group.length; offset += 400) {
        const rows = statement.all(JSON.stringify(group.slice(offset, offset + 400).map((ref) => ref.id))) as {
          source_id: string;
          type: unknown;
          id: unknown;
        }[];
        for (const row of rows) {
          const sourceKey = key({ type, id: row.source_id });
          if (links.get(sourceKey) || typeof row.type !== 'string' || typeof row.id !== 'string' || !row.id) continue;
          const target = normalize({ type: row.type, id: row.id });
          links.set(sourceKey, target);
          if (!links.has(key(target))) pending.set(key(target), target);
        }
      }
    }
  }
  return refs.map((ref) => {
    let target = normalize(ref);
    const seen = new Set<string>();
    while (!seen.has(key(target))) {
      seen.add(key(target));
      const next = links.get(key(target));
      if (!next) break;
      target = next;
    }
    return { type: ref.type, id: ref.id, objectType: target.type, objectId: target.id };
  });
}

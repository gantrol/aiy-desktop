-- Reader sessions used the shared chat/draft tables, not dedicated book tables.
-- Match the structured task marker; filenames and translated titles are not identities.
CREATE TEMP TABLE retired_reading_turns AS
SELECT id, scope_kind, scope_id FROM creator_agent_turns
WHERE CASE WHEN json_valid(request_json)
  THEN json_type(request_json, '$.documentTask.readingOutline') = 'object'
  ELSE 0 END;

-- Once reused or consumed, a draft is ordinary authored content. Keep it and
-- remove only the reader history. Unused recovery drafts belong to the reader.
CREATE TEMP TABLE retired_reading_drafts AS
SELECT draft.id FROM creation_drafts draft
WHERE draft.id IN (SELECT scope_id FROM retired_reading_turns WHERE scope_kind = 'DRAFT')
  AND draft.consumed_at IS NULL
  AND draft.source_series_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM creator_agent_turns turn
    WHERE turn.scope_kind = 'DRAFT' AND turn.scope_id = draft.id
      AND turn.id NOT IN (SELECT id FROM retired_reading_turns))
  AND NOT EXISTS (SELECT 1 FROM assistant_runs run WHERE run.scope_kind = 'DRAFT' AND run.scope_id = draft.id)
  AND NOT EXISTS (SELECT 1 FROM derived_visuals visual WHERE visual.creation_draft_id = draft.id)
  AND NOT EXISTS (SELECT 1 FROM calendar_handoff_sources source
    WHERE source.source_type = 'CREATION_DRAFT' AND source.source_id = draft.id)
  AND NOT EXISTS (SELECT 1 FROM creation_draft_materials material WHERE material.creation_draft_id = draft.id);

CREATE TEMP TABLE retired_reading_processes AS
SELECT id FROM ai_processes
WHERE creator_agent_turn_id IN (SELECT id FROM retired_reading_turns)
  OR (scope_kind = 'DRAFT' AND scope_id IN (SELECT id FROM retired_reading_drafts));

CREATE TEMP TABLE retired_reading_changes AS
SELECT id FROM change_events
WHERE (entity_type = 'CREATOR_AGENT_TURN' AND entity_id IN (SELECT id FROM retired_reading_turns))
  OR (entity_type = 'CREATION_DRAFT' AND entity_id IN (SELECT id FROM retired_reading_drafts))
  OR (entity_type = 'AI_PROCESS' AND entity_id IN (SELECT id FROM retired_reading_processes))
  OR (entity_type = 'AI_PROCESS_EVENT' AND entity_id IN (
    SELECT id FROM ai_process_events WHERE process_id IN (SELECT id FROM retired_reading_processes)));

-- Retirement also removes calendar copies. Suspend the immutable-history guard
-- only inside this migration transaction, restoring it before committing.
DROP TRIGGER calendar_activity_override_revisions_no_delete;
DELETE FROM calendar_activity_override_revisions WHERE event_id IN (SELECT id FROM retired_reading_changes);
CREATE TRIGGER calendar_activity_override_revisions_no_delete
BEFORE DELETE ON calendar_activity_override_revisions
BEGIN SELECT RAISE(ABORT, 'Calendar corrections are immutable'); END;
DELETE FROM calendar_activity_overrides WHERE event_id IN (SELECT id FROM retired_reading_changes);
DELETE FROM calendar_file_event_times WHERE event_id IN (SELECT id FROM retired_reading_changes);
UPDATE calendar_state SET revision = revision + 1 WHERE EXISTS (SELECT 1 FROM retired_reading_changes);
DELETE FROM change_events WHERE id IN (SELECT id FROM retired_reading_changes);

-- Schema migration runs with foreign keys disabled: remove children explicitly.
DELETE FROM ai_process_context_turns
WHERE process_id IN (SELECT id FROM retired_reading_processes)
  OR creator_agent_turn_id IN (SELECT id FROM retired_reading_turns);
DELETE FROM ai_process_events WHERE process_id IN (SELECT id FROM retired_reading_processes);
DELETE FROM ai_process_external_refs WHERE process_id IN (SELECT id FROM retired_reading_processes);
DELETE FROM ai_process_attempts WHERE process_id IN (SELECT id FROM retired_reading_processes);
DELETE FROM ai_processes WHERE id IN (SELECT id FROM retired_reading_processes);
DELETE FROM creator_agent_turns WHERE id IN (SELECT id FROM retired_reading_turns);
DELETE FROM creation_input_stashes
WHERE scope_kind = 'DRAFT' AND scope_id IN (SELECT id FROM retired_reading_drafts);
DELETE FROM creation_drafts WHERE id IN (SELECT id FROM retired_reading_drafts);

DROP TABLE retired_reading_changes;
DROP TABLE retired_reading_processes;
DROP TABLE retired_reading_drafts;
DROP TABLE retired_reading_turns;

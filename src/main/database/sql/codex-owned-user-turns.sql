WITH owned_turns AS (
  SELECT turn.*, source.thread_created_ms, source.invalid_records, source.oversized_records,
    source.turn_metadata_complete, source.history_retained, source.updated_at
  FROM usage_chat_turns AS turn
  JOIN usage_source_files AS source ON source.session_id = turn.source_session_id
  WHERE source.thread_source = 'USER'
    AND turn.terminal_state IN ('COMPLETED', 'ABORTED')
    AND turn.terminal_ms >= COALESCE(@fromEpoch, 0) AND turn.terminal_ms <= @toEpoch
    AND COALESCE(turn.started_ms, turn.terminal_ms) >= source.thread_created_ms
    AND (length(turn.turn_id) <> 36 OR lower(substr(turn.turn_id, 15, 1)) <> '7'
      OR substr(lower(replace(turn.turn_id, '-', '')), 1, 12) >= printf('%012x', source.thread_created_ms))
    AND NOT EXISTS (
      SELECT 1 FROM usage_chat_turns AS previous
      JOIN usage_source_files AS previous_source ON previous_source.session_id = previous.source_session_id
      WHERE previous.turn_id = turn.turn_id
        AND COALESCE(previous.started_ms, previous.terminal_ms) >= previous_source.thread_created_ms
        AND (length(previous.turn_id) <> 36 OR lower(substr(previous.turn_id, 15, 1)) <> '7'
          OR substr(lower(replace(previous.turn_id, '-', '')), 1, 12) >= printf('%012x', previous_source.thread_created_ms))
        AND (COALESCE(previous.started_ms, previous.terminal_ms), previous_source.thread_created_ms, previous.source_session_id)
          < (COALESCE(turn.started_ms, turn.terminal_ms), source.thread_created_ms, turn.source_session_id)
    )
)

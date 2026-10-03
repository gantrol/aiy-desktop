WITH candidates AS MATERIALIZED (
  SELECT turn.*, source.thread_created_ms, source.invalid_records, source.oversized_records,
    source.turn_metadata_complete, source.history_retained, source.updated_at
  FROM usage_chat_turns AS turn
  JOIN usage_source_files AS source ON source.session_id = turn.source_session_id
  WHERE source.thread_source = 'USER'
    AND (@sessionIds IS NULL OR turn.source_session_id IN (SELECT value FROM json_each(@sessionIds)))
    AND turn.terminal_state IN ('COMPLETED', 'ABORTED')
    AND turn.terminal_ms >= COALESCE(@fromEpoch, 0) AND turn.terminal_ms <= @toEpoch
    AND turn.started_ms >= source.thread_created_ms
    AND (turn.source_session_id, turn.turn_id) > (@sessionId, @turnId)
    AND NOT EXISTS (
      SELECT 1 FROM usage_chat_turns AS previous
      JOIN usage_source_files AS previous_source ON previous_source.session_id = previous.source_session_id
      WHERE previous.turn_id = turn.turn_id
        AND previous.started_ms >= previous_source.thread_created_ms
        AND (previous.started_ms, previous_source.thread_created_ms, previous.source_session_id)
          < (turn.started_ms, source.thread_created_ms, turn.source_session_id)
    )
  ORDER BY turn.source_session_id, turn.turn_id
  LIMIT @pageSize
)
SELECT turn.source_session_id AS sessionId, turn.turn_id AS turnId,
  CASE WHEN COUNT(DISTINCT event.model) > 1 OR MIN(event.model) <> turn.model THEN NULL ELSE turn.model END AS model,
  turn.reasoning_effort AS reasoningEffort,
  CASE WHEN COUNT(DISTINCT event.service_tier) > 1 OR MIN(event.service_tier) <> turn.service_tier
    THEN 'UNKNOWN' ELSE turn.service_tier END AS serviceTier,
  turn.updated_at AS importedAt,
  turn.started_ms AS startedMs, turn.terminal_ms AS terminalMs,
  turn.terminal_state AS terminalState, turn.duration_ms AS durationMs,
  CASE WHEN turn.invalid_records = 0 AND turn.oversized_records = 0
      AND turn.turn_metadata_complete = 1
      AND turn.thread_created_ms > 0 AND COUNT(event.event_order) > 0
      AND MIN(event.timestamp_ms) >= turn.started_ms AND MAX(event.timestamp_ms) <= turn.terminal_ms
    THEN SUM(event.output_tokens) ELSE NULL END AS outputTokens,
  CASE WHEN turn.invalid_records > 0 OR turn.oversized_records > 0
      OR turn.turn_metadata_complete = 0 OR turn.history_retained = 1 OR turn.thread_created_ms = 0
    THEN 1 ELSE 0 END AS partial
FROM candidates AS turn
LEFT JOIN usage_events AS event
  ON event.source_session_id = turn.source_session_id AND event.turn_id = turn.turn_id AND event.total_tokens > 0
GROUP BY turn.source_session_id, turn.turn_id
ORDER BY turn.source_session_id, turn.turn_id;

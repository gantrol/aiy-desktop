, candidates AS MATERIALIZED (
  SELECT * FROM owned_turns
  WHERE (@sessionIds IS NULL OR source_session_id IN (SELECT value FROM json_each(@sessionIds)))
    AND (source_session_id, turn_id) > (@sessionId, @turnId)
  ORDER BY source_session_id, turn_id LIMIT @pageSize
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
  CASE WHEN turn.invalid_records > 0 OR turn.oversized_records > 0 OR turn.started_ms IS NULL
      OR turn.turn_metadata_complete = 0 OR turn.history_retained = 1 OR turn.thread_created_ms = 0
    THEN 1 ELSE 0 END AS partial
FROM candidates AS turn
LEFT JOIN usage_events AS event
  ON event.source_session_id = turn.source_session_id AND event.turn_id = turn.turn_id AND event.total_tokens > 0
GROUP BY turn.source_session_id, turn.turn_id
ORDER BY turn.source_session_id, turn.turn_id;

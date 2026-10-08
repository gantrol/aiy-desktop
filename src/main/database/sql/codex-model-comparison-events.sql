SELECT owned.source_session_id AS sessionId, owned.turn_id AS turnId,
  owned.terminal_ms AS terminalMs,
  CASE WHEN owned.started_ms > owned.terminal_ms THEN NULL
    ELSE COALESCE(owned.duration_ms, owned.terminal_ms - owned.started_ms) END AS durationMs,
  owned.model AS turnModel, owned.reasoning_effort AS reasoningEffort, owned.service_tier AS serviceTier,
  COALESCE(event.event_order, -1) AS eventOrder,
  event.timestamp, event.model AS eventModel, event.service_tier AS eventServiceTier,
  COALESCE(event.input_tokens, 0) AS inputTokens,
  COALESCE(event.cached_input_tokens, 0) AS cachedInputTokens,
  COALESCE(event.cache_write_input_tokens, 0) AS cacheWriteInputTokens,
  COALESCE(event.output_tokens, 0) AS outputTokens,
  COALESCE(event.reasoning_output_tokens, 0) AS reasoningOutputTokens,
  COALESCE(event.total_tokens, 0) AS totalTokens
FROM owned_turns AS owned
LEFT JOIN usage_events AS event
  ON event.source_session_id = owned.source_session_id AND event.turn_id = owned.turn_id
  AND event.total_tokens > 0
  AND owned.invalid_records = 0 AND owned.oversized_records = 0 AND owned.turn_metadata_complete = 1
  AND owned.started_ms IS NOT NULL AND owned.thread_created_ms > 0
  AND NOT EXISTS (
    SELECT 1 FROM usage_events AS outside
    WHERE outside.source_session_id = owned.source_session_id AND outside.turn_id = owned.turn_id
      AND outside.total_tokens > 0
      AND (outside.timestamp_ms < owned.started_ms OR outside.timestamp_ms > owned.terminal_ms)
  )
WHERE owned.terminal_state = 'COMPLETED'
  AND (owned.terminal_ms, owned.source_session_id, owned.turn_id, COALESCE(event.event_order, -1))
    > (@terminalMs, @sessionId, @turnId, @eventOrder)
ORDER BY owned.terminal_ms, owned.source_session_id, owned.turn_id, event.event_order
LIMIT @pageSize;

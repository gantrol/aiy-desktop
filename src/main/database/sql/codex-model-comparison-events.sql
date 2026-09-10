WITH owned_turns AS (
  SELECT current.*
  FROM usage_chat_turns AS current
  INNER JOIN usage_source_files AS source ON source.session_id = current.source_session_id
  WHERE source.thread_source = 'USER'
    AND source.invalid_records = 0
    AND source.oversized_records = 0
    AND current.terminal_state = 'COMPLETED'
    AND current.terminal_ms >= COALESCE(@fromEpoch, 0)
    AND current.terminal_ms <= @toEpoch
    AND (
      source.thread_created_ms = 0
      OR length(current.turn_id) <> 36
      OR lower(substr(current.turn_id, 15, 1)) <> '7'
      OR substr(lower(replace(current.turn_id, '-', '')), 1, 12) >= printf('%012x', source.thread_created_ms)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM usage_chat_turns AS previous
      INNER JOIN usage_source_files AS previous_source ON previous_source.session_id = previous.source_session_id
      WHERE previous.turn_id = current.turn_id
        AND (previous.started_ms, previous_source.thread_created_ms, previous.source_session_id)
          < (current.started_ms, source.thread_created_ms, current.source_session_id)
        AND (
          previous_source.thread_created_ms = 0
          OR length(previous.turn_id) <> 36
          OR lower(substr(previous.turn_id, 15, 1)) <> '7'
          OR substr(lower(replace(previous.turn_id, '-', '')), 1, 12)
            >= printf('%012x', previous_source.thread_created_ms)
        )
    )
)
SELECT
  owned.source_session_id AS sessionId,
  owned.turn_id AS turnId,
  owned.terminal_ms AS terminalMs,
  owned.duration_ms AS durationMs,
  owned.model AS turnModel,
  owned.reasoning_effort AS reasoningEffort,
  owned.service_tier AS serviceTier,
  COALESCE(event.event_order, -1) AS eventOrder,
  event.timestamp,
  event.model AS eventModel,
  event.service_tier AS eventServiceTier,
  COALESCE(event.input_tokens, 0) AS inputTokens,
  COALESCE(event.cached_input_tokens, 0) AS cachedInputTokens,
  COALESCE(event.cache_write_input_tokens, 0) AS cacheWriteInputTokens,
  COALESCE(event.output_tokens, 0) AS outputTokens,
  COALESCE(event.reasoning_output_tokens, 0) AS reasoningOutputTokens,
  COALESCE(event.total_tokens, 0) AS totalTokens
FROM owned_turns AS owned
LEFT JOIN usage_events AS event
  ON event.source_session_id = owned.source_session_id
  AND event.turn_id = owned.turn_id
  AND event.total_tokens > 0
WHERE (owned.terminal_ms, owned.source_session_id, owned.turn_id, COALESCE(event.event_order, -1))
  > (@terminalMs, @sessionId, @turnId, @eventOrder)
ORDER BY owned.terminal_ms, owned.source_session_id, owned.turn_id, event.event_order
LIMIT @pageSize;

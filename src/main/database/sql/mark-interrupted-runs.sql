INSERT INTO background_job_events (
  id,
  job_id,
  attempt_id,
  sequence,
  event_type,
  phase,
  progress,
  status_message,
  payload_json,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  job.id,
  (
    SELECT attempt.id
    FROM background_job_attempts attempt
    WHERE attempt.job_id = job.id
    ORDER BY attempt.attempt_no DESC
    LIMIT 1
  ),
  (
    SELECT COALESCE(MAX(existing.sequence), 0) + 1
    FROM background_job_events existing
    WHERE existing.job_id = job.id
  ),
  CASE WHEN job.desired_state = 'CANCEL' THEN 'CANCELLED' ELSE 'APPLICATION_CLOSED' END,
  CASE WHEN job.desired_state = 'CANCEL' THEN 'CANCELLED' ELSE 'INTERRUPTED' END,
  job.progress,
  NULL,
  CASE
    WHEN job.desired_state = 'CANCEL' THEN '{"errorCode":"USER_CANCELLED"}'
    ELSE '{"errorCode":"APPLICATION_CLOSED"}'
  END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM background_jobs job
WHERE job.kind = 'GENERATION' AND job.status IN ('QUEUED', 'RUNNING');

UPDATE background_job_attempts
SET
  status = CASE
    WHEN EXISTS (
      SELECT 1 FROM background_jobs job
      WHERE job.id = background_job_attempts.job_id AND job.desired_state = 'CANCEL'
    ) THEN 'CANCELLED'
    ELSE 'INTERRUPTED'
  END,
  phase = CASE
    WHEN EXISTS (
      SELECT 1 FROM background_jobs job
      WHERE job.id = background_job_attempts.job_id AND job.desired_state = 'CANCEL'
    ) THEN 'CANCELLED'
    ELSE 'INTERRUPTED'
  END,
  recovery_mode = CASE
    WHEN EXISTS (
      SELECT 1 FROM background_jobs job
      WHERE job.id = background_job_attempts.job_id AND job.desired_state = 'CANCEL'
    ) THEN recovery_mode
    WHEN provider_request_id IS NOT NULL THEN 'RECONCILE'
    ELSE 'RETRY'
  END,
  retryable = CASE
    WHEN EXISTS (
      SELECT 1 FROM background_jobs job
      WHERE job.id = background_job_attempts.job_id AND job.desired_state = 'CANCEL'
    ) THEN 0
    ELSE 1
  END,
  worker_id = NULL,
  lease_expires_at = NULL,
  status_message = NULL,
  error_code = CASE
    WHEN EXISTS (
      SELECT 1 FROM background_jobs job
      WHERE job.id = background_job_attempts.job_id AND job.desired_state = 'CANCEL'
    ) THEN 'USER_CANCELLED'
    ELSE 'APPLICATION_CLOSED'
  END,
  error_message = NULL,
  finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('QUEUED', 'RUNNING')
  AND job_id IN (SELECT id FROM background_jobs WHERE kind = 'GENERATION');

UPDATE background_jobs
SET
  status = CASE WHEN desired_state = 'CANCEL' THEN 'CANCELLED' ELSE 'INTERRUPTED' END,
  phase = CASE WHEN desired_state = 'CANCEL' THEN 'CANCELLED' ELSE 'INTERRUPTED' END,
  revision = revision + 1,
  status_message = NULL,
  error_code = CASE WHEN desired_state = 'CANCEL' THEN 'USER_CANCELLED' ELSE 'APPLICATION_CLOSED' END,
  error_message = NULL,
  finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'GENERATION' AND status IN ('QUEUED', 'RUNNING');

UPDATE generation_runs
SET
  status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM generation_job_links link
      JOIN background_jobs job ON job.id = link.job_id
      WHERE link.generation_run_id = generation_runs.id AND job.desired_state = 'CANCEL'
    ) THEN 'CANCELLED'
    ELSE 'INTERRUPTED'
  END,
  error_code = CASE
    WHEN EXISTS (
      SELECT 1
      FROM generation_job_links link
      JOIN background_jobs job ON job.id = link.job_id
      WHERE link.generation_run_id = generation_runs.id AND job.desired_state = 'CANCEL'
    ) THEN 'USER_CANCELLED'
    ELSE 'APPLICATION_CLOSED'
  END,
  error_message = NULL,
  finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('QUEUED', 'RUNNING');

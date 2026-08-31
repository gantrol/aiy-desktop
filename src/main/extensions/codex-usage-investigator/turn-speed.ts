import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  codexUsageTurnSpeedAnalysisSchema,
  type CodexUsageTurnSpeedAnalysis,
  type CodexUsageTurnSpeedComparison,
} from '@/shared/contracts/codex-usage';

const countSchema = z.number().int().nonnegative().safe();

const turnSpeedRowSchema = z
  .object({
    completedTurnCount: countSchema,
    validTurnCount: countSchema,
    comparableTurnCount: countSchema,
    excludedInvalidDurationTurnCount: countSchema,
    excludedUnknownServiceTierTurnCount: countSchema,
    excludedUnknownCohortTurnCount: countSchema,
    model: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.string().min(1).max(100).nullable(),
    standardTurnCount: countSchema.nullable(),
    standardMedianDurationMs: z.number().finite().positive().nullable(),
    fastTurnCount: countSchema.nullable(),
    fastMedianDurationMs: z.number().finite().positive().nullable(),
  })
  .strict();

function actualSpeedMultiplier(standardMedianDurationMs: number | null, fastMedianDurationMs: number | null) {
  if (standardMedianDurationMs === null || fastMedianDurationMs === null || fastMedianDurationMs <= 0) return null;
  const multiplier = standardMedianDurationMs / fastMedianDurationMs;
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

export function readCodexTurnSpeedAnalysis(
  database: Database.Database,
  fromEpoch: number | null,
  toEpoch: number,
): CodexUsageTurnSpeedAnalysis {
  const rows = z
    .array(turnSpeedRowSchema)
    .max(1_000)
    .parse(
      database
        .prepare(
          `WITH self_owned_turns AS (
           SELECT chat_turn.*
           FROM usage_chat_turns AS chat_turn
           INNER JOIN usage_source_files AS source
             ON source.session_id = chat_turn.source_session_id
           WHERE source.thread_created_ms = 0
              OR length(chat_turn.turn_id) <> 36
              OR lower(substr(chat_turn.turn_id, 15, 1)) <> '7'
              OR substr(lower(replace(chat_turn.turn_id, '-', '')), 1, 12)
                 >= printf('%012x', source.thread_created_ms)
         ), owned_turns AS (
           SELECT current.*
           FROM self_owned_turns AS current
           INNER JOIN usage_source_files AS current_source
             ON current_source.session_id = current.source_session_id
           WHERE NOT EXISTS (
             SELECT 1
             FROM self_owned_turns AS previous
             INNER JOIN usage_source_files AS previous_source
               ON previous_source.session_id = previous.source_session_id
             WHERE previous.turn_id = current.turn_id
               AND (previous.started_ms, previous_source.thread_created_ms, previous.source_session_id)
                 < (current.started_ms, current_source.thread_created_ms, current.source_session_id)
           )
         ), range_turns AS (
           SELECT *
           FROM owned_turns
           WHERE terminal_state = 'COMPLETED'
             AND terminal_ms >= COALESCE(?, 0)
             AND terminal_ms <= ?
         ), classified AS (
           SELECT
             range_turns.*,
             CASE
               WHEN duration_ms IS NULL OR duration_ms <= 0 THEN 'INVALID_DURATION'
               WHEN service_tier NOT IN ('STANDARD', 'FAST') THEN 'UNKNOWN_SERVICE_TIER'
               WHEN model IS NULL OR length(trim(model)) = 0
                 OR reasoning_effort IS NULL OR length(trim(reasoning_effort)) = 0 THEN 'UNKNOWN_COHORT'
               ELSE 'VALID'
             END AS classification
           FROM range_turns
         ), valid_samples AS (
           SELECT model, reasoning_effort, service_tier, duration_ms, turn_id
           FROM classified
           WHERE classification = 'VALID'
         ), ranked AS (
           SELECT
             valid_samples.*,
             ROW_NUMBER() OVER (
               PARTITION BY model, reasoning_effort, service_tier
               ORDER BY duration_ms ASC, turn_id ASC
             ) AS duration_rank,
             COUNT(*) OVER (PARTITION BY model, reasoning_effort, service_tier) AS sample_count
           FROM valid_samples
         ), tier_statistics AS (
           SELECT
             model,
             reasoning_effort,
             service_tier,
             MAX(sample_count) AS turn_count,
             AVG(
               CASE
                 WHEN duration_rank IN ((sample_count + 1) / 2, (sample_count + 2) / 2) THEN duration_ms
                 ELSE NULL
               END
             ) AS median_duration_ms
           FROM ranked
           GROUP BY model, reasoning_effort, service_tier
         ), cohorts AS (
           SELECT
             model,
             reasoning_effort,
             COALESCE(MAX(CASE WHEN service_tier = 'STANDARD' THEN turn_count END), 0) AS standard_turn_count,
             MAX(CASE WHEN service_tier = 'STANDARD' THEN median_duration_ms END) AS standard_median_duration_ms,
             COALESCE(MAX(CASE WHEN service_tier = 'FAST' THEN turn_count END), 0) AS fast_turn_count,
             MAX(CASE WHEN service_tier = 'FAST' THEN median_duration_ms END) AS fast_median_duration_ms
           FROM tier_statistics
           GROUP BY model, reasoning_effort
         ), coverage AS (
           SELECT
             COUNT(*) AS completed_turn_count,
             COALESCE(SUM(CASE WHEN classification = 'VALID' THEN 1 ELSE 0 END), 0) AS valid_turn_count,
             COALESCE(SUM(CASE WHEN classification = 'INVALID_DURATION' THEN 1 ELSE 0 END), 0)
               AS excluded_invalid_duration_turn_count,
             COALESCE(SUM(CASE WHEN classification = 'UNKNOWN_SERVICE_TIER' THEN 1 ELSE 0 END), 0)
               AS excluded_unknown_service_tier_turn_count,
             COALESCE(SUM(CASE WHEN classification = 'UNKNOWN_COHORT' THEN 1 ELSE 0 END), 0)
               AS excluded_unknown_cohort_turn_count
           FROM classified
         ), comparable_coverage AS (
           SELECT COALESCE(
             SUM(
               CASE
                 WHEN standard_turn_count > 0 AND fast_turn_count > 0
                   THEN standard_turn_count + fast_turn_count
                 ELSE 0
               END
             ),
             0
           ) AS comparable_turn_count
           FROM cohorts
         )
         SELECT
           coverage.completed_turn_count AS completedTurnCount,
           coverage.valid_turn_count AS validTurnCount,
           comparable_coverage.comparable_turn_count AS comparableTurnCount,
           coverage.excluded_invalid_duration_turn_count AS excludedInvalidDurationTurnCount,
           coverage.excluded_unknown_service_tier_turn_count AS excludedUnknownServiceTierTurnCount,
           coverage.excluded_unknown_cohort_turn_count AS excludedUnknownCohortTurnCount,
           cohorts.model,
           cohorts.reasoning_effort AS reasoningEffort,
           cohorts.standard_turn_count AS standardTurnCount,
           cohorts.standard_median_duration_ms AS standardMedianDurationMs,
           cohorts.fast_turn_count AS fastTurnCount,
           cohorts.fast_median_duration_ms AS fastMedianDurationMs
         FROM coverage
         CROSS JOIN comparable_coverage
         LEFT JOIN cohorts ON 1 = 1
         ORDER BY
           CASE WHEN cohorts.standard_turn_count > 0 AND cohorts.fast_turn_count > 0 THEN 0 ELSE 1 END,
           MIN(cohorts.standard_turn_count, cohorts.fast_turn_count) DESC,
           (cohorts.standard_turn_count + cohorts.fast_turn_count) DESC,
           cohorts.model ASC,
           cohorts.reasoning_effort ASC
         LIMIT 1000`,
        )
        .all(fromEpoch, toEpoch),
    );
  const coverage = rows[0];
  const comparisons = rows.flatMap((row): CodexUsageTurnSpeedComparison[] => {
    if (!row.model || !row.reasoningEffort) return [];
    const standardTurnCount = row.standardTurnCount ?? 0;
    const fastTurnCount = row.fastTurnCount ?? 0;
    return [
      {
        model: row.model,
        reasoningEffort: row.reasoningEffort,
        standard: {
          completedTurnCount: standardTurnCount,
          medianDurationMs: standardTurnCount > 0 ? row.standardMedianDurationMs : null,
        },
        fast: {
          completedTurnCount: fastTurnCount,
          medianDurationMs: fastTurnCount > 0 ? row.fastMedianDurationMs : null,
        },
        actualSpeedMultiplier: actualSpeedMultiplier(row.standardMedianDurationMs, row.fastMedianDurationMs),
      },
    ];
  });
  return codexUsageTurnSpeedAnalysisSchema.parse({
    definition: 'TASK_COMPLETE_DURATION',
    algorithmVersion: 1,
    comparisonScope: 'SINGLE_NORMALIZED_MODEL_AND_REASONING_EFFORT',
    rangeAssignment: 'COMPLETION_TIMESTAMP',
    officialSpeedMultiplier: 1.5,
    completedTurnCount: coverage?.completedTurnCount ?? 0,
    validTurnCount: coverage?.validTurnCount ?? 0,
    comparableTurnCount: coverage?.comparableTurnCount ?? 0,
    excludedInvalidDurationTurnCount: coverage?.excludedInvalidDurationTurnCount ?? 0,
    excludedUnknownServiceTierTurnCount: coverage?.excludedUnknownServiceTierTurnCount ?? 0,
    excludedUnknownCohortTurnCount: coverage?.excludedUnknownCohortTurnCount ?? 0,
    comparisons,
  });
}

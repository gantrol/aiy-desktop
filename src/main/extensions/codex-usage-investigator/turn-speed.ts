import type { CodexModelComparisonAnalysis } from '@/shared/contracts/codex-model-comparison';
import { codexUsageTurnSpeedAnalysisSchema, type CodexUsageTurnSpeedComparison } from '@/shared/contracts/codex-usage';

/** Use the exact same retained user-turn cohorts as the A/B workspace. */
export function summarizeCodexTurnSpeed(analysis: CodexModelComparisonAnalysis) {
  const cohorts = new Map<string, CodexUsageTurnSpeedComparison>();
  let invalidDuration = 0;
  let unknownMode = 0;
  let unknownCohort = analysis.excludedModelTurnCount;
  let valid = 0;
  for (const row of analysis.byReasoningEffort) {
    invalidDuration += row.completedTurnCount - row.durationTurnCount;
    if (row.serviceTier === 'UNKNOWN') {
      unknownMode += row.durationTurnCount;
      continue;
    }
    if (!row.reasoningEffort || row.reasoningEffort.toLowerCase() === 'unknown') {
      unknownCohort += row.durationTurnCount;
      continue;
    }
    valid += row.durationTurnCount;
    const key = JSON.stringify([row.model, row.reasoningEffort]);
    const cohort = cohorts.get(key) ?? {
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      standard: { completedTurnCount: 0, medianDurationMs: null },
      fast: { completedTurnCount: 0, medianDurationMs: null },
      actualSpeedMultiplier: null,
      officialSpeed: { multiplier: null, source: 'UNKNOWN' as const, asOf: null },
    };
    cohort[row.serviceTier === 'FAST' ? 'fast' : 'standard'] = {
      completedTurnCount: row.durationTurnCount,
      medianDurationMs: row.medianDurationMs,
    };
    cohorts.set(key, cohort);
  }
  const comparisons = [...cohorts.values()];
  for (const row of comparisons) {
    const a = row.standard.medianDurationMs,
      b = row.fast.medianDurationMs;
    row.actualSpeedMultiplier = a !== null && b !== null && a > 0 && b > 0 ? a / b : null;
  }
  return codexUsageTurnSpeedAnalysisSchema.parse({
    definition: 'OWNED_USER_COMPLETED_TURN_DURATION',
    algorithmVersion: 2,
    comparisonScope: 'SINGLE_NORMALIZED_MODEL_AND_REASONING_EFFORT',
    rangeAssignment: 'COMPLETION_TIMESTAMP',
    samplesTruncated: analysis.samplesTruncated,
    completedTurnCount: analysis.completedTurnCount,
    validTurnCount: valid,
    comparableTurnCount: comparisons.reduce(
      (sum, row) =>
        sum +
        (row.standard.completedTurnCount && row.fast.completedTurnCount
          ? row.standard.completedTurnCount + row.fast.completedTurnCount
          : 0),
      0,
    ),
    excludedInvalidDurationTurnCount: invalidDuration,
    excludedUnknownServiceTierTurnCount: unknownMode,
    excludedUnknownCohortTurnCount: unknownCohort,
    comparisons,
  });
}

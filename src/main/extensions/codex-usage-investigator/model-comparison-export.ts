import type { CodexUsageInvestigation } from '@/shared/contracts/codex-usage';

export function codexModelComparisonExportRows(investigation: CodexUsageInvestigation) {
  const analysis = investigation.modelComparison;
  if (!analysis) return [];
  return [
    { scope: 'MODEL', rows: analysis.byModel },
    { scope: 'MODEL_AND_REASONING_EFFORT', rows: analysis.byReasoningEffort },
  ].flatMap(({ scope, rows }) =>
    rows.map((row) => ({
      record_kind: 'MODEL_COMPARISON',
      analysis_scope: scope,
      generated_at: investigation.generatedAt,
      range: investigation.range,
      time_zone: investigation.timeZone,
      analysis_definition: analysis.definition,
      algorithm_version: analysis.algorithmVersion,
      range_assignment: analysis.rangeAssignment,
      model: row.model,
      reasoning_effort: row.reasoningEffort,
      service_tier: row.serviceTier,
      completed_turn_count: row.completedTurnCount,
      session_count: row.sessionCount,
      duration_sample_count: row.durationTurnCount,
      usage_sample_count: row.usageTurnCount,
      api_priced_turn_count: row.apiPricedTurnCount,
      credit_priced_turn_count: row.creditPricedTurnCount,
      median_duration_ms: row.medianDurationMs,
      median_requests_per_turn: row.medianRequests,
      median_total_tokens_per_turn: row.medianTotalTokens,
      median_output_tokens_per_turn: row.medianOutputTokens,
      median_api_equivalent_usd_per_turn: row.medianApiEquivalentUsd,
      median_codex_credits_per_turn: row.medianCodexCredits,
      cached_input_percent: row.cachedInputPercent,
      distribution_method: row.distributions ? 'LINEAR_INTERPOLATED_PERCENTILES_P0_TO_P100' : null,
      turn_distributions_json: row.distributions ? JSON.stringify(row.distributions) : null,
      samples_truncated: analysis.samplesTruncated ? 1 : 0,
      excluded_model_turn_count: analysis.excludedModelTurnCount,
      valuation_kind: 'public_rate_equivalent_not_billed_spend',
    })),
  );
}

import type { CodexUsageInvestigation } from '@/shared/contracts/codex-usage';
import { codexOutputTokensPerSecond } from '@/shared/codex-output-throughput';

export function codexModelComparisonExportRows(investigation: CodexUsageInvestigation) {
  const analysis = investigation.modelComparison;
  if (!analysis) return [];
  const rows = [
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
  const throughput = analysis.outputThroughput;
  return [
    ...rows,
    ...(throughput?.groups ?? []).map((group) => ({
      record_kind: 'OUTPUT_THROUGHPUT',
      generated_at: investigation.generatedAt,
      time_zone: investigation.timeZone,
      range_assignment: 'TERMINAL_TIMESTAMP',
      analysis_definition: 'OWNED_USER_COMPLETED_AND_ABORTED_TURNS',
      model: group.model,
      reasoning_effort: group.reasoningEffort,
      service_tier: group.serviceTier,
      output_tokens_per_second: codexOutputTokensPerSecond(group.throughput),
      paired_output_tokens: group.throughput.outputTokens,
      paired_duration_ms: group.throughput.durationMs,
      paired_turn_count: group.throughput.pairedTurnCount,
      completed_turn_count: group.throughput.completedTurnCount,
      aborted_turn_count: group.throughput.abortedTurnCount,
      missing_usage_turn_count: group.throughput.missingUsageTurnCount,
      invalid_duration_turn_count: group.throughput.invalidDurationTurnCount,
      includes_tools_and_waits: 1,
      generation_tokens_per_second: null,
      generation_measurement: 'NOT_MEASURED',
      partial: group.throughput.partial ? 1 : 0,
      samples_truncated: throughput?.truncated ? 1 : 0,
    })),
  ];
}

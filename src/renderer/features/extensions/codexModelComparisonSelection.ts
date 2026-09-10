import type { CodexModelComparisonMetric, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import {
  CODEX_MODEL_COMPARISON_METRIC_INDEX,
  codexModelComparisonDistribution,
} from '@/shared/codex-model-comparison-distribution';

export interface CodexModelComparisonSelection {
  // null means all values, including values introduced by a refreshed report.
  models: string[] | null;
  modes: CodexModelComparisonRow['serviceTier'][] | null;
  efforts: (string | null)[] | null;
}

export function selectedCodexModelComparisonGroups(
  groups: CodexModelComparisonRow[],
  selection: CodexModelComparisonSelection,
) {
  return groups.filter(
    (group) =>
      (selection.models === null || selection.models.includes(group.model)) &&
      (selection.modes === null || selection.modes.includes(group.serviceTier)) &&
      (selection.efforts === null || selection.efforts.includes(group.reasoningEffort)),
  );
}

export function selectedCodexModelComparisonDistribution(
  groups: CodexModelComparisonRow[],
  metric: CodexModelComparisonMetric,
) {
  const index = CODEX_MODEL_COMPARISON_METRIC_INDEX[metric];
  return codexModelComparisonDistribution(
    groups.flatMap((group) => group.samples?.map((sample) => sample[index]) ?? []),
  );
}

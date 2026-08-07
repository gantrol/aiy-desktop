import { useMemo } from 'react';
import type { GenerationTargetInput } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { generationBatchPlan } from '@/renderer/components/creator/generationBatchPlan';

interface Props {
  targets: GenerationTargetInput[];
  onTargetsChange(targets: GenerationTargetInput[]): void;
}

const commonRepeatCounts = [1, 2, 3, 4, 5, 8, 10];

export function GenerationBatchControl({ targets, onTargetsChange }: Props) {
  const labels = useI18n().messages.creator.generationTargets;
  const plan = generationBatchPlan(targets);
  const options = useMemo(() => {
    const values = new Set(commonRepeatCounts);
    if (plan.uniformRepeatCount !== null) values.add(plan.uniformRepeatCount);
    return [...values].sort((left, right) => left - right);
  }, [plan.uniformRepeatCount]);
  const value = plan.uniformRepeatCount === null ? 'custom' : String(plan.uniformRepeatCount);
  const summary =
    plan.uniformRepeatCount === null
      ? labels.batchTotal(plan.modelCount, plan.totalCount)
      : labels.batchSummary(plan.modelCount, plan.uniformRepeatCount, plan.totalCount);

  return (
    <div
      data-generation-batch-control
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2"
    >
      <span className="text-sm font-medium text-foreground">{labels.batchTask}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <Label className="shrink-0 text-xs font-normal text-muted-foreground">{labels.repeatEachModel}</Label>
        <Select
          value={value}
          disabled={!targets.length}
          onValueChange={(next) => {
            if (next === 'custom') return;
            const count = Number(next);
            if (!Number.isInteger(count) || count < 1) return;
            onTargetsChange(targets.map((target) => ({ ...target, count })));
          }}
        >
          <SelectTrigger
            data-action="batch-repeat-count"
            className="h-8 w-24 bg-surface px-2 font-mono tabular-nums"
            aria-label={labels.repeatEachModel}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {plan.uniformRepeatCount === null && (
              <SelectItem value="custom" disabled>
                {labels.customCounts}
              </SelectItem>
            )}
            {options.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {labels.repeatOption(count)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span
        data-generation-batch-summary
        className="w-full text-right text-xs tabular-nums text-muted-foreground sm:w-auto"
      >
        {summary}
      </span>
    </div>
  );
}

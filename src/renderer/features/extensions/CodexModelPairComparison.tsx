import { useId, useMemo, useState } from 'react';
import { ChevronDownIcon, InfoIcon } from 'lucide-react';
import type { CodexModelComparisonMetric, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { CodexModelDistributionChart } from '@/renderer/features/extensions/CodexModelDistributionChart';
import { CodexModelComparisonSelector } from '@/renderer/features/extensions/CodexModelComparisonSelector';
import { CodexModelComparisonSamples } from '@/renderer/features/extensions/CodexModelComparisonSamples';
import {
  readCodexModelComparisonPreferences,
  saveCodexModelComparisonPreferences,
  type CodexModelComparisonPreferences,
} from '@/renderer/features/extensions/codexModelComparisonPreferences';
import {
  selectedCodexModelComparisonGroups,
  selectedCodexModelComparisonDistribution,
  type CodexModelComparisonSelection,
} from '@/renderer/features/extensions/codexModelComparisonSelection';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];
const METRICS: CodexModelComparisonMetric[] = [
  'durationMs',
  'requests',
  'totalTokens',
  'outputTokens',
  'apiEquivalentUsd',
  'codexCredits',
];

export function CodexModelPairComparison({
  byReasoningEffort,
  labels,
  numbers,
  tokens,
  money,
  date,
}: {
  byReasoningEffort: CodexModelComparisonRow[];
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}) {
  const [preferences, setPreferences] = useState(readCodexModelComparisonPreferences);
  const { selection, metric } = preferences;
  const id = useId();
  const pair = useMemo(() => {
    const models = [...new Set(byReasoningEffort.map((group) => group.model))].sort((a, b) => a.localeCompare(b));
    return ([0, 1] as const).map((index) => {
      const value = selection[index] ?? {
        models: models.length ? [models[index] ?? models[0]!] : [],
        modes: null,
        efforts: null,
      };
      return { selection: value, groups: selectedCodexModelComparisonGroups(byReasoningEffort, value) };
    });
  }, [byReasoningEffort, selection]);
  function changePreferences(value: CodexModelComparisonPreferences) {
    setPreferences(value);
    saveCodexModelComparisonPreferences(value);
  }
  const distributions = useMemo(
    () => pair.map(({ groups }) => selectedCodexModelComparisonDistribution(groups, metric)),
    [pair, metric],
  );
  const rowLabel = (value: CodexModelComparisonSelection) =>
    [
      value.models === null ? labels.allModels : value.models.join(', ') || labels.noneSelected,
      value.modes === null
        ? labels.allModes
        : value.modes.map((mode) => labels.modes[mode]).join(', ') || labels.noneSelected,
      value.efforts === null
        ? labels.allEfforts
        : value.efforts.map((effort) => effort ?? labels.unknownEffort).join(', ') || labels.noneSelected,
    ].join(' · ');
  const format = (value: number) =>
    metric === 'apiEquivalentUsd'
      ? money.format(value)
      : metric === 'durationMs'
        ? numbers.format(value / 1_000)
        : metric === 'totalTokens' || metric === 'outputTokens'
          ? tokens.format(value)
          : numbers.format(value);
  const samplesAvailable = byReasoningEffort.every((group) => group.samples !== null);
  const seriesFor = (index: number) => ({
    label: rowLabel(pair[index]!.selection),
    distribution: distributions[index] ?? null,
    total: pair[index]!.groups.reduce((sum, group) => sum + group.completedTurnCount, 0),
  });
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-4 @3xl/codex-usage:grid-cols-2">
        {pair.map((side, index) => (
          <CodexModelComparisonSelector
            key={index}
            selection={side.selection}
            groups={byReasoningEffort}
            label={index ? labels.compareB : labels.compareA}
            labels={labels}
            onChange={(value) =>
              changePreferences({
                selection: index ? [pair[0]!.selection, value] : [value, pair[1]!.selection],
                metric,
              })
            }
          />
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @sm/codex-usage:grid-cols-[auto_minmax(0,16rem)_auto] @sm/codex-usage:justify-start">
        <Label htmlFor={`${id}-metric`} className="col-span-2 text-xs @sm/codex-usage:col-span-1">
          {labels.distribution}
        </Label>
        <Select
          value={metric}
          onValueChange={(value) => {
            if (METRICS.includes(value as CodexModelComparisonMetric)) {
              changePreferences({
                selection: [pair[0]!.selection, pair[1]!.selection],
                metric: value as CodexModelComparisonMetric,
              });
            }
          }}
        >
          <SelectTrigger id={`${id}-metric`} className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-0 max-w-[calc(100vw-2rem)]">
            {METRICS.map((key) => (
              <SelectItem key={key} value={key} className="break-words whitespace-normal">
                {labels.metrics[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} aria-label={labels.distribution} className="inline-flex text-muted-foreground">
              <InfoIcon className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[min(24rem,calc(100vw-2rem))] break-words">
            {labels.distributionNote}
            {metric === 'codexCredits' && (
              <>
                <br />
                {labels.creditQuota}
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      {!samplesAvailable ? (
        <div className="grid min-h-20 place-items-center text-sm text-muted-foreground">{labels.rescan}</div>
      ) : (
        <CodexModelDistributionChart
          series={[seriesFor(0), seriesFor(1)]}
          metricLabel={labels.metrics[metric]}
          labels={labels}
          numbers={numbers}
          format={format}
        />
      )}
      <Collapsible defaultOpen={false} className="min-w-0">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group gap-2 px-0 hover:bg-transparent">
            <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
            {labels.selectedSamples}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0 pt-2">
          {samplesAvailable ? (
            <CodexModelComparisonSamples
              key={JSON.stringify(pair.map((side) => side.selection))}
              first={pair[0]!.groups}
              second={pair[1]!.groups}
              labels={labels}
              numbers={numbers}
              tokens={tokens}
              money={money}
              date={date}
            />
          ) : (
            <div className="py-3 text-sm text-muted-foreground">{labels.rescan}</div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

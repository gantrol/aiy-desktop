import { useId, useState } from 'react';
import { ChevronDownIcon, InfoIcon } from 'lucide-react';
import type { CodexModelComparisonAnalysis, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Label } from '@/renderer/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { CodexModelPairComparison } from '@/renderer/features/extensions/CodexModelPairComparison';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];
const PREFERENCE_KEY = 'aiy:codex-model-comparison:split-effort';

function savedSplitEffort() {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function CoverageCell({
  value,
  count,
  total,
  formatter,
  label,
}: {
  value: number | null;
  count: number;
  total: number;
  formatter: Intl.NumberFormat;
  label: string;
}) {
  return (
    <TableCell numeric>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{value === null ? '—' : formatter.format(value)}</span>
        </TooltipTrigger>
        <TooltipContent>
          {label}: {count} / {total}
        </TooltipContent>
      </Tooltip>
    </TableCell>
  );
}

function ComparisonRow({
  row,
  splitEffort,
  labels,
  numbers,
  tokens,
  money,
}: {
  row: CodexModelComparisonRow;
  splitEffort: boolean;
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
}) {
  const coverage = { total: row.completedTurnCount, label: labels.coverage };
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-mono text-xs">{row.model}</TableCell>
      {splitEffort && <TableCell>{row.reasoningEffort ?? labels.unknownEffort}</TableCell>}
      <TableCell>{labels.modes[row.serviceTier]}</TableCell>
      <TableCell numeric>{numbers.format(row.completedTurnCount)}</TableCell>
      <CoverageCell
        {...coverage}
        value={row.medianDurationMs === null ? null : row.medianDurationMs / 1_000}
        count={row.durationTurnCount}
        formatter={numbers}
      />
      <CoverageCell {...coverage} value={row.medianRequests} count={row.usageTurnCount} formatter={numbers} />
      <CoverageCell {...coverage} value={row.medianTotalTokens} count={row.usageTurnCount} formatter={tokens} />
      <CoverageCell {...coverage} value={row.medianOutputTokens} count={row.usageTurnCount} formatter={tokens} />
      <CoverageCell {...coverage} value={row.medianApiEquivalentUsd} count={row.apiPricedTurnCount} formatter={money} />
      <CoverageCell
        {...coverage}
        value={row.medianCodexCredits}
        count={row.creditPricedTurnCount}
        formatter={numbers}
      />
      <TableCell numeric>
        {row.cachedInputPercent === null ? '—' : `${numbers.format(row.cachedInputPercent)}%`}
      </TableCell>
    </TableRow>
  );
}

export function CodexModelComparisonResults({
  analysis,
  labels,
  numbers,
  tokens,
  money,
  date,
}: {
  analysis: CodexModelComparisonAnalysis | null;
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}) {
  const [splitEffort, setSplitEffort] = useState(savedSplitEffort);
  const checkboxId = useId();
  const rows = (splitEffort ? analysis?.byReasoningEffort : analysis?.byModel) ?? [];
  function changeSplitEffort(value: boolean) {
    setSplitEffort(value);
    try {
      globalThis.localStorage?.setItem(PREFERENCE_KEY, String(value));
    } catch {
      // Keep the selection for this mounted view when storage is unavailable.
    }
  }
  return (
    <Collapsible defaultOpen={false} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group gap-2 px-0 hover:bg-transparent">
              <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
              {labels.title}
            </Button>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label={labels.title} className="inline-flex text-muted-foreground">
                <InfoIcon className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(24rem,calc(100vw-2rem))] break-words">
              {labels.scope}
              <br />
              {labels.pricing}
              <br />
              {labels.creditQuota}
            </TooltipContent>
          </Tooltip>
          {analysis?.samplesTruncated && <Badge variant="outline">{labels.truncated}</Badge>}
        </div>
      </div>
      <CollapsibleContent className="grid min-w-0 gap-3">
        {analysis && (analysis.byModel.length > 0 || analysis.byReasoningEffort.length > 0) ? (
          <>
            <CodexModelPairComparison
              byReasoningEffort={analysis.byReasoningEffort}
              labels={labels}
              numbers={numbers}
              tokens={tokens}
              money={money}
              date={date}
              samplesTruncated={analysis.samplesTruncated}
            />
            <Collapsible defaultOpen={false} className="min-w-0">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="group mb-2 gap-2 px-0 hover:bg-transparent">
                  <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
                  {labels.summary}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid min-w-0 gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={splitEffort}
                    onCheckedChange={(value) => changeSplitEffort(value === true)}
                  />
                  <Label htmlFor={checkboxId} className="min-w-0 text-xs">
                    {labels.splitEffort}
                  </Label>
                </div>
                <div className="min-w-0 max-w-full max-h-[30rem] overflow-auto border-y">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{labels.model}</TableHead>
                        {splitEffort && <TableHead>{labels.effort}</TableHead>}
                        <TableHead>{labels.mode}</TableHead>
                        <TableHead numeric>{labels.turns}</TableHead>
                        <TableHead numeric>{labels.duration}</TableHead>
                        <TableHead numeric>{labels.requests}</TableHead>
                        <TableHead numeric>{labels.tokens}</TableHead>
                        <TableHead numeric>{labels.output}</TableHead>
                        <TableHead numeric>{labels.api}</TableHead>
                        <TableHead numeric>{labels.credits}</TableHead>
                        <TableHead numeric>{labels.cache}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <ComparisonRow
                          key={JSON.stringify([row.model, row.reasoningEffort, row.serviceTier])}
                          row={row}
                          splitEffort={splitEffort}
                          labels={labels}
                          numbers={numbers}
                          tokens={tokens}
                          money={money}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          <div className="grid min-h-20 place-items-center text-sm text-muted-foreground">
            {analysis ? labels.empty : labels.rescan}
          </div>
        )}
        {Boolean(analysis?.excludedModelTurnCount) && (
          <span className="text-xs text-muted-foreground">
            {labels.excluded}: {analysis?.excludedModelTurnCount}
          </span>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

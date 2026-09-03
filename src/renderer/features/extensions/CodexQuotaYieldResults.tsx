import { HardDriveIcon, TargetIcon } from 'lucide-react';
import type { CodexUsageQuotaCycle, CodexUsageQuotaYieldAnalysis, CodexUsageServiceTier } from '@/shared/contracts';
import { codexUsageStandardEquivalentMultiplier } from '@/shared/codex-usage-speed';
import { Badge } from '@/renderer/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexUsageServiceTierLabel } from '@/renderer/features/extensions/CodexUsageServiceTierLabel';
import type { useI18n } from '@/renderer/i18n/useI18n';

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

const publicReportVersion = 3;

interface QuotaYieldResultsProps {
  analysis: CodexUsageQuotaYieldAnalysis;
  labels: UsageLabels;
  tokens: Intl.NumberFormat;
  numbers: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}

function modelLabel(model: string) {
  if (model === 'gpt-5.6-sol') return 'Sol';
  if (model === 'gpt-5.6-luna') return 'Luna';
  if (model === 'gpt-5.6-terra') return 'Terra';
  return model;
}

function serviceTierLabel(serviceTier: CodexUsageServiceTier, labels: UsageLabels) {
  return labels.quotaYield.modes[serviceTier];
}

function cyclePeriod(cycle: CodexUsageQuotaCycle, date: Intl.DateTimeFormat) {
  return `${date.format(new Date(cycle.observedFrom))} – ${date.format(new Date(cycle.observedTo))}`;
}

function standardEquivalentTokensPerOnePercent(cycle: CodexUsageQuotaCycle) {
  if (cycle.standardEquivalentTokensPerOnePercent !== null) return cycle.standardEquivalentTokensPerOnePercent;
  let standardEquivalentTokens = cycle.totalTokens;
  for (const share of cycle.modelShares) {
    const multiplier = codexUsageStandardEquivalentMultiplier(share.model, share.serviceTier);
    standardEquivalentTokens += share.totalTokens * (multiplier - 1);
  }
  return standardEquivalentTokens / cycle.quotaPercentConsumed;
}

export function CodexQuotaYieldResults({ analysis, labels, tokens, numbers, date }: QuotaYieldResultsProps) {
  const cycles = [...analysis.cycles].reverse();
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <TargetIcon className="size-4" />
          {labels.quotaYield.title}
        </span>
        <Badge variant="outline">v{publicReportVersion}</Badge>
        <Badge variant="outline">
          {cycles.length} {labels.quotaYield.cycles}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <HardDriveIcon className="size-3.5" />
        <span>
          {analysis.storedFrom ? date.format(new Date(analysis.storedFrom)) : '—'} –{' '}
          {analysis.storedTo ? date.format(new Date(analysis.storedTo)) : '—'}
        </span>
        <span className="hidden @lg/codex-usage:inline">·</span>
        <span className="hidden @lg/codex-usage:inline">
          {analysis.storedSessionCount} {labels.metrics.sessions} · {tokens.format(analysis.sourceEventCount)}{' '}
          {labels.quotaYield.events}
        </span>
      </div>
      <div className="max-h-96 overflow-auto border-y">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.quotaYield.cycle}</TableHead>
              <TableHead>{labels.quotaYield.observedPeriod}</TableHead>
              <TableHead>{labels.quotaYield.plan}</TableHead>
              <TableHead numeric>{labels.quotaYield.quotaMovement}</TableHead>
              <TableHead numeric>{labels.metrics.totalTokens}</TableHead>
              <TableHead numeric>{labels.quotaYield.tokensPerOnePercent}</TableHead>
              <TableHead numeric>{labels.quotaYield.standardEquivalentTokensPerOnePercent}</TableHead>
              <TableHead numeric>{labels.quotaYield.nonCachedTokensPerOnePercent}</TableHead>
              <TableHead numeric>{labels.quotaYield.cachedInputPercent}</TableHead>
              <TableHead>{labels.quotaYield.modelTokenShare}</TableHead>
              <TableHead numeric>{labels.table.requests}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycles.map((cycle) => {
              const standardEquivalentTokens = standardEquivalentTokensPerOnePercent(cycle);
              return (
                <TableRow key={cycle.cycleKey}>
                  <TableCell className="whitespace-nowrap text-xs">{cyclePeriod(cycle, date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {date.format(new Date(cycle.resetsAt * 1_000))}
                  </TableCell>
                  <TableCell>{cycle.planType}</TableCell>
                  <TableCell numeric className="whitespace-nowrap">
                    {numbers.format(cycle.baselineUsedPercent)}→{numbers.format(cycle.maximumUsedPercent)} ·{' '}
                    {numbers.format(cycle.quotaPercentConsumed)}%
                  </TableCell>
                  <TableCell numeric>{tokens.format(cycle.totalTokens)}</TableCell>
                  <TableCell numeric className="font-semibold">
                    {tokens.format(cycle.tokensPerOnePercent)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {tokens.format(standardEquivalentTokens)}
                  </TableCell>
                  <TableCell numeric>{tokens.format(cycle.nonCachedTokensPerOnePercent)}</TableCell>
                  <TableCell numeric>{numbers.format(cycle.cachedInputPercent)}%</TableCell>
                  <TableCell>
                    <div className="flex min-w-48 flex-wrap gap-x-2 gap-y-0.5 text-xs tabular-nums">
                      {cycle.modelShares.map((share) => (
                        <span key={`${share.model}:${share.serviceTier}`} className="whitespace-nowrap">
                          {modelLabel(share.model)} ·{' '}
                          <CodexUsageServiceTierLabel
                            label={serviceTierLabel(share.serviceTier, labels)}
                            inferred={share.inferredServiceTierTokens > 0}
                            inferenceHint={labels.quotaYield.inferredMode}
                          />{' '}
                          {numbers.format(share.tokenPercent)}%
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell numeric>{cycle.requestCount}</TableCell>
                </TableRow>
              );
            })}
            {!cycles.length && (
              <TableRow>
                <TableCell colSpan={11} className="h-20 text-center text-muted-foreground">
                  {labels.quotaYield.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

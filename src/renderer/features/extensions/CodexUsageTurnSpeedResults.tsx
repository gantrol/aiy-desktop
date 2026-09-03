import { GaugeIcon } from 'lucide-react';
import type { CodexUsageTurnSpeedAnalysis, CodexUsageTurnSpeedComparison } from '@/shared/contracts/codex-usage';
import { Badge } from '@/renderer/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import type { useI18n } from '@/renderer/i18n/useI18n';

type TurnSpeedLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['turnSpeed'];

interface Props {
  analysis: CodexUsageTurnSpeedAnalysis;
  labels: TurnSpeedLabels;
  numbers: Intl.NumberFormat;
}

function formatDuration(durationMs: number | null, numbers: Intl.NumberFormat, units: TurnSpeedLabels['units']) {
  if (durationMs === null) return '—';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${numbers.format(hours)} ${units.hours} ${numbers.format(minutes)} ${units.minutes}`;
  if (minutes > 0) return `${numbers.format(minutes)} ${units.minutes} ${numbers.format(seconds)} ${units.seconds}`;
  return `${numbers.format(seconds)} ${units.seconds}`;
}

function formatMultiplier(value: number | null, numbers: Intl.NumberFormat) {
  return value === null ? '—' : `${numbers.format(value)}×`;
}

function CohortMedian({
  comparison,
  serviceTier,
  labels,
  numbers,
}: {
  comparison: CodexUsageTurnSpeedComparison;
  serviceTier: 'standard' | 'fast';
  labels: TurnSpeedLabels;
  numbers: Intl.NumberFormat;
}) {
  const summary = comparison[serviceTier];
  return (
    <div className="grid justify-items-end gap-0.5">
      <span className="tabular-nums">{formatDuration(summary.medianDurationMs, numbers, labels.units)}</span>
      <span className="text-[11px] text-muted-foreground">
        {summary.completedTurnCount} {labels.turns}
      </span>
    </div>
  );
}

export function CodexUsageTurnSpeedResults({ analysis, labels, numbers }: Props) {
  const primary =
    analysis.comparisons.find((comparison) => comparison.actualSpeedMultiplier !== null) ??
    analysis.comparisons[0] ??
    null;
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <GaugeIcon className="size-4" />
        {labels.title}
        <Badge variant="outline" className="hidden @md/codex-usage:inline-flex">
          {labels.official} {analysis.officialSpeedMultiplier}×
        </Badge>
        {primary && (
          <>
            <Badge variant="secondary">{primary.model}</Badge>
            <Badge variant="outline" className="hidden @xl/codex-usage:inline-flex">
              {primary.reasoningEffort}
            </Badge>
          </>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px bg-border @4xl/codex-usage:grid-cols-4 [&>*]:bg-background">
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.actualSpeed}</dt>
          <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
            {formatMultiplier(primary?.actualSpeedMultiplier ?? null, numbers)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.officialSpeed}</dt>
          <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
            {analysis.officialSpeedMultiplier}×
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.standardMedian}</dt>
          <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
            {formatDuration(primary?.standard.medianDurationMs ?? null, numbers, labels.units)}
          </dd>
          {primary && (
            <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
              {primary.standard.completedTurnCount} {labels.turns}
            </dd>
          )}
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.fastMedian}</dt>
          <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
            {formatDuration(primary?.fast.medianDurationMs ?? null, numbers, labels.units)}
          </dd>
          {primary && (
            <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
              {primary.fast.completedTurnCount} {labels.turns}
            </dd>
          )}
        </div>
      </dl>

      {analysis.comparisons.length ? (
        <div className="max-h-64 overflow-auto border-y">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.cohort}</TableHead>
                <TableHead numeric>{labels.standardMedian}</TableHead>
                <TableHead numeric>{labels.fastMedian}</TableHead>
                <TableHead numeric>{labels.actualSpeed}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.comparisons.map((comparison) => (
                <TableRow key={`${comparison.model}:${comparison.reasoningEffort}`}>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="font-mono text-xs">{comparison.model}</span>
                      <span className="text-[11px] text-muted-foreground">{comparison.reasoningEffort}</span>
                    </div>
                  </TableCell>
                  <TableCell numeric>
                    <CohortMedian comparison={comparison} serviceTier="standard" labels={labels} numbers={numbers} />
                  </TableCell>
                  <TableCell numeric>
                    <CohortMedian comparison={comparison} serviceTier="fast" labels={labels} numbers={numbers} />
                  </TableCell>
                  <TableCell numeric className="font-medium tabular-nums">
                    {formatMultiplier(comparison.actualSpeedMultiplier, numbers)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid min-h-16 place-items-center text-sm text-muted-foreground">{labels.empty}</div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {analysis.completedTurnCount} {labels.completed}
        </Badge>
        <Badge variant="outline">
          {analysis.comparableTurnCount} {labels.comparable}
        </Badge>
        {analysis.excludedUnknownServiceTierTurnCount > 0 && (
          <span>
            {analysis.excludedUnknownServiceTierTurnCount} {labels.unknownMode}
          </span>
        )}
        {analysis.excludedUnknownCohortTurnCount > 0 && (
          <span>
            {analysis.excludedUnknownCohortTurnCount} {labels.unknownCohort}
          </span>
        )}
        {analysis.excludedInvalidDurationTurnCount > 0 && (
          <span>
            {analysis.excludedInvalidDurationTurnCount} {labels.invalidDuration}
          </span>
        )}
      </div>
    </section>
  );
}

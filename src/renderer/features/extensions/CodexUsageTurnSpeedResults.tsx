import type { CodexUsageTurnSpeedAnalysis } from '@/shared/contracts/codex-usage';
import { observedTaskDurationRatio } from '@/shared/codex-usage-evidence';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['turnSpeed'];

export function CodexUsageTurnSpeedResults({
  analysis,
  labels,
  numbers,
}: {
  analysis: CodexUsageTurnSpeedAnalysis;
  labels: Labels;
  numbers: Intl.NumberFormat;
}) {
  const text = useI18n().messages.extensions.codexUsageInvestigator.evidence;
  const note = `${text.speedNote} ${text.sampleNote}`;
  const duration = (value: number | null) =>
    value === null ? '—' : `${numbers.format(value / 1_000)} ${labels.units.seconds}`;
  return (
    <section className="grid min-w-0 gap-3 text-xs">
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        {text.generationMissing}
        <CodexUsageEvidenceHelp label={note}>{note}</CodexUsageEvidenceHelp>
      </h3>
      <div className="max-h-96 overflow-auto border-y">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{labels.cohort}</TableHead>
              <TableHead numeric>{labels.standardMedian}</TableHead>
              <TableHead numeric>{labels.fastMedian}</TableHead>
              <TableHead numeric>{text.taskRatio}</TableHead>
              <TableHead numeric>{text.official}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.comparisons.map((comparison) => {
              const ratio = observedTaskDurationRatio(comparison);
              return (
                <TableRow key={JSON.stringify([comparison.model, comparison.reasoningEffort])}>
                  <TableCell>
                    <p className="font-mono">{comparison.model}</p>
                    <p>{comparison.reasoningEffort}</p>
                  </TableCell>
                  <TableCell numeric>
                    {duration(comparison.standard.medianDurationMs)}
                    <p>n={numbers.format(comparison.standard.completedTurnCount)}</p>
                  </TableCell>
                  <TableCell numeric>
                    {duration(comparison.fast.medianDurationMs)}
                    <p>n={numbers.format(comparison.fast.completedTurnCount)}</p>
                  </TableCell>
                  <TableCell numeric>{ratio === null ? '—' : `${numbers.format(ratio)}×`}</TableCell>
                  <TableCell numeric>
                    {comparison.officialSpeed.multiplier === null
                      ? '—'
                      : `${numbers.format(comparison.officialSpeed.multiplier)}×`}
                    <p className="text-muted-foreground">
                      {labels.officialSources[comparison.officialSpeed.source]} {comparison.officialSpeed.asOf}
                    </p>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!analysis.comparisons.length && <p>{text.noData}</p>}
      <p>
        {labels.completed}: {numbers.format(analysis.completedTurnCount)} · {labels.unknownMode}:{' '}
        {numbers.format(analysis.excludedUnknownServiceTierTurnCount)} · {labels.unknownCohort}:{' '}
        {numbers.format(analysis.excludedUnknownCohortTurnCount)} · {labels.invalidDuration}:{' '}
        {numbers.format(analysis.excludedInvalidDurationTurnCount)}
      </p>
    </section>
  );
}

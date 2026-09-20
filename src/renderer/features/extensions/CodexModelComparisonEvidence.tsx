import { useId } from 'react';
import type { CodexModelComparisonMetric } from '@/shared/contracts/codex-model-comparison';
import { observedThresholdShare, parseEvidenceThreshold, type CodexSampleSummary } from '@/shared/codex-usage-evidence';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import type { useI18n } from '@/renderer/i18n/useI18n';

type EvidenceLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['evidence'];

export function CodexModelComparisonEvidence({
  summaries,
  metric,
  metricLabel,
  numbers,
  format,
  limit,
  onLimitChange,
  text,
}: {
  summaries: readonly [CodexSampleSummary, CodexSampleSummary];
  metric: CodexModelComparisonMetric;
  metricLabel: string;
  numbers: Intl.NumberFormat;
  format(value: number): string;
  limit: string;
  onLimitChange(value: string): void;
  text: EvidenceLabels;
}) {
  const id = useId();
  const threshold = parseEvidenceThreshold(limit, metric);
  const invalid = limit.trim() !== '' && threshold === null;
  const show = (value: number | null) => (value === null ? '—' : format(value));
  const metrics = [
    ['total', text.total],
    ['mean', text.mean],
    ['p50', text.median],
    ['p90', text.tail],
  ] as const;
  return (
    <section className="grid min-w-0 gap-3" aria-label={text.table}>
      <div className="grid gap-2 @xl/codex-usage:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={id}>
              {text.threshold} · {metricLabel}
            </Label>
            <CodexUsageEvidenceHelp label={text.thresholdNote}>{text.thresholdNote}</CodexUsageEvidenceHelp>
          </div>
          <Input
            id={id}
            type="text"
            inputMode="decimal"
            maxLength={80}
            value={limit}
            onChange={(event) => onLimitChange(event.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-help` : undefined}
            className="max-w-64 tabular-nums"
          />
          {invalid && (
            <p id={`${id}-help`} className="text-xs text-destructive">
              {text.invalidThreshold}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 border-b pb-3" aria-live="polite">
          {summaries.map((summary, index) => {
            const share = observedThresholdShare(summary.values, threshold);
            return (
              <div key={index} className="grid content-start gap-1">
                <p className="text-xs">
                  {index ? 'B' : 'A'} · {text.within}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {share ? `${numbers.format(share.count)}/${numbers.format(share.total)}` : '—'}
                </p>
                {share && (
                  <>
                    <p className="text-xs tabular-nums">{numbers.format(share.percent)}%</p>
                    <div className="h-1.5 bg-muted" aria-hidden="true">
                      <div className="h-full bg-foreground/65" style={{ width: `${share.percent}%` }} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs font-medium">
        <span>{text.table}</span>
        <CodexUsageEvidenceHelp label={`${text.totalNote} ${text.tailNote}`}>
          {text.totalNote} {text.tailNote}
        </CodexUsageEvidenceHelp>
      </div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{metricLabel}</TableHead>
            <TableHead numeric>A</TableHead>
            <TableHead numeric>B</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableHead scope="row">{text.sample}</TableHead>
            {summaries.map((summary, index) => (
              <TableCell numeric key={index}>
                {numbers.format(summary.valid)} / {numbers.format(summary.eligible)}
              </TableCell>
            ))}
          </TableRow>
          {metrics.map(([key, label]) => (
            <TableRow key={key}>
              <TableHead scope="row">{label}</TableHead>
              {summaries.map((summary, index) => (
                <TableCell numeric key={index}>
                  {show(summary[key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow>
            <TableHead scope="row">{text.middle}</TableHead>
            {summaries.map((summary, index) => (
              <TableCell numeric key={index}>
                {show(summary.p25)} – {show(summary.p75)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableHead scope="row">{text.missing}</TableHead>
            {summaries.map((summary, index) => (
              <TableCell numeric key={index}>
                {numbers.format(summary.missingMetric)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableHead scope="row">{text.notRetained}</TableHead>
            {summaries.map((summary, index) => (
              <TableCell numeric key={index}>
                {summary.notRetained === null ? '—' : numbers.format(summary.notRetained)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </section>
  );
}

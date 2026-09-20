import { useMemo, useState } from 'react';
import type { CodexUsageInvestigation, CodexUsageQuotaPuritySample } from '@/shared/contracts/codex-usage';
import { groupCodexQuotaPurity } from '@/shared/codex-quota-purity';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import type { CodexEvidenceFormatters } from '@/renderer/features/extensions/CodexUsageEvidenceOverview';
import { useI18n } from '@/renderer/i18n/useI18n';

type Metric = 'total' | 'nonCached';
const PAGE_SIZE = 50;
const nonCachedTokensPerOnePercent = (point: CodexUsageQuotaPuritySample) =>
  (Math.max(0, point.inputTokens - point.cachedInputTokens) + point.outputTokens) / point.quotaPercentConsumed;
const valueOf = (point: CodexUsageQuotaPuritySample, metric: Metric) =>
  metric === 'total' ? point.tokensPerOnePercent : nonCachedTokensPerOnePercent(point);

function change(points: CodexUsageQuotaPuritySample[], index: number, metric: Metric) {
  const point = points[index],
    previous = points[index - 1];
  const value = point ? valueOf(point, metric) : null,
    previousValue = previous ? valueOf(previous, metric) : null;
  return value !== null && previousValue !== null && previousValue > 0 ? (value / previousValue - 1) * 100 : null;
}

function PurityChart({
  points,
  metric,
  numbers,
  date,
  unit,
  offset = 0,
  compact = false,
}: {
  points: CodexUsageQuotaPuritySample[];
  metric: Metric;
  numbers: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
  unit: string;
  offset?: number;
  compact?: boolean;
}) {
  const text = useI18n().messages.extensions.codexUsageInvestigator.purity;
  const shown = compact ? points.slice(-16) : points;
  const firstIndex = offset + points.length - shown.length + 1;
  if (!shown.length) return null;
  const width = 600,
    height = compact ? 58 : 180,
    pad = compact ? 3 : 28;
  const maximum = Math.max(Number.EPSILON, ...shown.map((point) => valueOf(point, metric)));
  const positions = shown.map((point, index) => {
    const value = valueOf(point, metric);
    return {
      point,
      value,
      x: shown.length === 1 ? width / 2 : pad + (index / (shown.length - 1)) * (width - pad * 2),
      y: height - pad - (value / maximum) * (height - pad * 2),
    };
  });
  return (
    <div className="grid gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={text.trend}
        className={compact ? 'h-10 w-full text-foreground' : 'h-44 w-full text-foreground'}
      >
        {!compact && (
          <>
            <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.2" />
            <text x={pad} y={16} fill="currentColor" fontSize="11">
              {numbers.format(maximum)}
            </text>
          </>
        )}
        {positions.map(({ point, value, x, y }, index) => (
          <g key={`${point.from}/${point.to}`}>
            {index > 0 && (
              <line
                x1={positions[index - 1]!.x}
                y1={positions[index - 1]!.y}
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="2"
              />
            )}
            <circle cx={x} cy={y} r={compact ? 2.5 : 3.5} fill="currentColor">
              <title>
                {text.observation} #{numbers.format(firstIndex + index)} · {date.format(new Date(point.from))} –{' '}
                {date.format(new Date(point.to))} · {numbers.format(point.quotaPercentConsumed)}% ·{' '}
                {numbers.format(value)} {unit}
              </title>
            </circle>
          </g>
        ))}
      </svg>
      {!compact && (
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {text.observation} #{numbers.format(firstIndex)}
          </span>
          {shown.length > 1 && <span>#{numbers.format(firstIndex + shown.length - 1)}</span>}
        </div>
      )}
    </div>
  );
}

function PurityInfo({ investigation }: { investigation: CodexUsageInvestigation }) {
  const labels = useI18n().messages.extensions.codexUsageInvestigator;
  const text = labels.purity,
    analysis = investigation.quotaPurity;
  const issues = analysis
    ? [
        analysis.mixedSampleCount ? `${text.mixed}: ${analysis.mixedSampleCount}` : '',
        analysis.nonConsecutiveSampleCount ? `${text.nonConsecutive}: ${analysis.nonConsecutiveSampleCount}` : '',
        analysis.missingQuotaEventCount ? `${text.missing}: ${analysis.missingQuotaEventCount}` : '',
        analysis.unknownSampleCount ? `${text.unknown}: ${analysis.unknownSampleCount}` : '',
        analysis.boundaryCount ? `${text.boundaries}: ${analysis.boundaryCount}` : '',
        analysis.staleSnapshotCount ? `${text.stale}: ${analysis.staleSnapshotCount}` : '',
        analysis.samplesTruncated ? text.truncated : '',
      ].filter(Boolean)
    : [text.unavailable];
  if (analysis && !analysis.samples.length) issues.push(text.noSamples);
  if (investigation.quotaPurityIssue) issues.push(text.issues[investigation.quotaPurityIssue]);
  const problem = !analysis?.samples.length || issues.length > 0;
  const content = [
    ...issues,
    text.crossDevice,
    text.method,
    analysis?.inferredSampleCount
      ? `${text.inferred}: ${analysis.inferredSampleCount}. ${labels.quotaYield.inferredMode}`
      : '',
    text.qualityNote,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <CodexUsageEvidenceHelp label={content} destructive={problem}>
      {content}
    </CodexUsageEvidenceHelp>
  );
}

export function CodexUsagePurityOverview({
  investigation,
  formatters,
}: {
  investigation: CodexUsageInvestigation;
  formatters: CodexEvidenceFormatters;
}) {
  const labels = useI18n().messages.extensions.codexUsageInvestigator;
  const groups = useMemo(() => groupCodexQuotaPurity(investigation.quotaPurity), [investigation.quotaPurity]);
  const rows = groups.slice(0, 3);
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-1">
        <span>{labels.quotaYield.tokensPerOnePercent}</span>
        <span className="text-muted-foreground">· {labels.purity.localScope}</span>
        <PurityInfo investigation={investigation} />
      </div>
      {rows.map((row) => {
        const latest = row.samples.at(-1),
          tokens = latest?.tokensPerOnePercent ?? null,
          delta = change(row.samples, row.samples.length - 1, 'total');
        return (
          <div key={row.key} className="grid gap-1">
            <span className="break-words">
              {row.sample.model} ·{' '}
              {labels.quotaYield.modes[row.sample.serviceTier === 'ALL' ? 'UNKNOWN' : row.sample.serviceTier]}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2 tabular-nums">
              <strong className="text-lg">{tokens === null ? '—' : formatters.tokens.format(tokens)}</strong>
              <span>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatters.numbers.format(delta)}%`}</span>
            </div>
            {latest && (
              <span className="text-muted-foreground">
                {formatters.date.format(new Date(latest.to))} · {row.sample.planType} ·{' '}
                {row.sample.limitId ?? labels.quota.defaultLimit} ·{' '}
                {row.sample.windowDurationMins === 10080
                  ? labels.purity.weekly
                  : `${formatters.numbers.format((row.sample.windowDurationMins ?? 0) / 60)}h`}
              </span>
            )}
            <PurityChart
              points={row.samples}
              metric="total"
              numbers={formatters.tokens}
              date={formatters.date}
              unit={labels.quotaYield.tokensPerOnePercent}
              compact
            />
          </div>
        );
      })}
      {!rows.length && <span className="text-lg tabular-nums">—</span>}
    </div>
  );
}

export function CodexUsagePurityDetails({
  investigation,
  formatters,
}: {
  investigation: CodexUsageInvestigation;
  formatters: CodexEvidenceFormatters;
}) {
  const labels = useI18n().messages.extensions.codexUsageInvestigator,
    text = labels.purity;
  const [selected, setSelected] = useState('');
  const [metric, setMetric] = useState<Metric>('total');
  const [page, setPage] = useState(0);
  const groups = useMemo(() => groupCodexQuotaPurity(investigation.quotaPurity), [investigation.quotaPurity]);
  const group = groups.find((item) => item.key === selected) ?? groups[0];
  const points = group?.samples ?? [];
  const count = Math.max(1, Math.ceil(points.length / PAGE_SIZE)),
    current = Math.min(page, count - 1);
  const offset = current * PAGE_SIZE;
  const shown = points.slice(offset, offset + PAGE_SIZE);
  const selectedLabel =
    metric === 'total' ? labels.quotaYield.tokensPerOnePercent : labels.quotaYield.nonCachedTokensPerOnePercent;
  const groupLabel = (row: (typeof groups)[number]) =>
    `${row.sample.model} · ${labels.quotaYield.modes[row.sample.serviceTier === 'ALL' ? 'UNKNOWN' : row.sample.serviceTier]} · ${row.sample.planType} · ${row.sample.limitId ?? labels.quota.defaultLimit} · ${row.sample.windowKind === 'PRIMARY' ? labels.quotaYield.primaryWindow : labels.quotaYield.secondaryWindow} ${formatters.numbers.format((row.sample.windowDurationMins ?? 0) / 60)}h`;
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={group?.key}
          onValueChange={(value) => {
            setSelected(value);
            setPage(0);
          }}
          disabled={!groups.length}
        >
          <SelectTrigger className="w-full min-w-0 @3xl/codex-usage:w-96" aria-label={text.series}>
            <SelectValue placeholder={text.series} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((row) => (
              <SelectItem key={row.key} value={row.key}>
                {groupLabel(row)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
          <SelectTrigger className="w-60" aria-label={text.metric}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="total">{labels.quotaYield.tokensPerOnePercent}</SelectItem>
            <SelectItem value="nonCached">{labels.quotaYield.nonCachedTokensPerOnePercent}</SelectItem>
          </SelectContent>
        </Select>
        <PurityInfo investigation={investigation} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <span>
          {text.observation}: {formatters.numbers.format(points.length)} · {selectedLabel} · {text.localScope}
        </span>
        <span>{text.change}</span>
      </div>
      <PurityChart
        points={shown}
        metric={metric}
        numbers={formatters.tokens}
        date={formatters.date}
        unit={selectedLabel}
        offset={offset}
      />
      <div className="overflow-auto border-y">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead numeric>{text.observation}</TableHead>
              <TableHead>{text.observedAt}</TableHead>
              <TableHead numeric>{selectedLabel}</TableHead>
              <TableHead numeric>{text.change}</TableHead>
              <TableHead numeric>{labels.quotaYield.nonCachedTokensPerOnePercent}</TableHead>
              <TableHead numeric>{labels.quotaYield.cachedInputPercent}</TableHead>
              <TableHead numeric>{labels.metrics.requests}</TableHead>
              <TableHead numeric>{labels.quotaYield.quotaPoints}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((point, position) => {
              const index = offset + position,
                delta = change(points, index, metric),
                value = valueOf(point, metric);
              return (
                <TableRow key={`${point.from}/${point.to}`}>
                  <TableCell numeric>{formatters.numbers.format(index + 1)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <time
                      dateTime={point.to}
                      title={`${formatters.date.format(new Date(point.from))} – ${formatters.date.format(new Date(point.to))}`}
                    >
                      {formatters.date.format(new Date(point.to))}
                    </time>
                  </TableCell>
                  <TableCell numeric>{formatters.tokens.format(value)}</TableCell>
                  <TableCell numeric>
                    {delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatters.numbers.format(delta)}%`}
                  </TableCell>
                  <TableCell numeric>{formatters.tokens.format(nonCachedTokensPerOnePercent(point))}</TableCell>
                  <TableCell numeric>
                    {formatters.numbers.format(
                      point.inputTokens > 0 ? (point.cachedInputTokens / point.inputTokens) * 100 : 0,
                    )}
                    %
                  </TableCell>
                  <TableCell numeric>{formatters.numbers.format(point.requestCount)}</TableCell>
                  <TableCell numeric>{formatters.numbers.format(point.quotaPercentConsumed)}%</TableCell>
                </TableRow>
              );
            })}
            {!points.length && (
              <TableRow>
                <TableCell colSpan={8} className="h-16 text-center">
                  {text.noSamples}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {points.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            aria-label={text.previous}
            onClick={() => setPage(current - 1)}
          >
            ←
          </Button>
          <span>
            {current + 1}/{count}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current + 1 === count}
            aria-label={text.next}
            onClick={() => setPage(current + 1)}
          >
            →
          </Button>
        </div>
      )}
    </div>
  );
}

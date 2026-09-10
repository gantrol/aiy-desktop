import { useId } from 'react';
import type { CodexModelComparisonDistribution } from '@/shared/contracts/codex-model-comparison';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];

interface Series {
  label: string;
  distribution: CodexModelComparisonDistribution | null;
  total: number;
}

const QUANTILES = [0, 10, 25, 50, 75, 90, 100] as const;
const PLOT = { left: 96, top: 16, width: 504, height: 200 };

function SeriesMark({ index }: { index: number }) {
  return (
    <svg width="24" height="12" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        x2="24"
        y1="6"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={index ? '5 3' : undefined}
      />
    </svg>
  );
}

export function CodexModelDistributionChart({
  series,
  metricLabel,
  labels,
  numbers,
  format,
}: {
  series: [Series, Series];
  metricLabel: string;
  labels: Labels;
  numbers: Intl.NumberFormat;
  format(value: number): string;
}) {
  const titleId = useId();
  const maximum = Math.max(...series.map((item) => item.distribution?.percentiles[100] ?? 0)) || 1;
  const hasSamples = series.some((item) => item.distribution !== null);
  const y = (value: number) => PLOT.top + PLOT.height * (1 - value / maximum);
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-2 text-xs @xl/codex-usage:grid-cols-2">
        {series.map((item, index) => (
          <div key={index} className="flex min-w-0 items-center gap-2">
            <SeriesMark index={index} />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]" title={item.label}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
      <div className="grid min-w-0 gap-3 @5xl/codex-usage:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @5xl/codex-usage:items-start">
        {hasSamples ? (
          <svg
            viewBox="0 0 624 254"
            role="img"
            aria-labelledby={titleId}
            className="mx-auto block h-auto w-full max-w-2xl text-foreground"
          >
            <title id={titleId}>
              {labels.distribution} · {metricLabel} · {series.map((item) => item.label).join(' / ')}
            </title>
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <g key={fraction}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.left + PLOT.width}
                  y1={y(maximum * fraction)}
                  y2={y(maximum * fraction)}
                  className="stroke-border"
                />
                <text
                  x={PLOT.left - 8}
                  y={y(maximum * fraction)}
                  dy="0.35em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {format(maximum * fraction)}
                </text>
              </g>
            ))}
            {QUANTILES.map((percentile) => (
              <text
                key={percentile}
                x={PLOT.left + (PLOT.width * percentile) / 100}
                y={PLOT.top + PLOT.height + 20}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                P{percentile}
              </text>
            ))}
            {series.map(
              (item, index) =>
                item.distribution && (
                  <polyline
                    key={index}
                    points={item.distribution.percentiles
                      .map((value, percentile) => `${PLOT.left + (PLOT.width * percentile) / 100},${y(value)}`)
                      .join(' ')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={index ? '5 4' : undefined}
                    strokeLinejoin="round"
                  />
                ),
            )}
          </svg>
        ) : (
          <div className="grid min-h-24 place-items-center text-sm text-muted-foreground">{labels.noMetricSamples}</div>
        )}
        <div className="min-w-0 max-w-full border-y">
          <Table className="table-fixed text-xs [&_td]:break-all [&_td]:whitespace-normal [&_th]:break-words [&_th]:whitespace-normal">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-[28%]">
                  {labels.percentile}
                </TableHead>
                {series.map((item, index) => (
                  <TableHead numeric scope="col" key={index} title={item.label}>
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <SeriesMark index={index} />
                      {index ? labels.compareB : labels.compareA}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableHead scope="row" className="font-normal">
                  {labels.coverage}
                </TableHead>
                {series.map((item, index) => (
                  <TableCell numeric key={index}>
                    {numbers.format(item.distribution?.sampleCount ?? 0)} / {numbers.format(item.total)}
                  </TableCell>
                ))}
              </TableRow>
              {QUANTILES.map((percentile) => (
                <TableRow key={percentile}>
                  <TableHead scope="row" className="font-normal">
                    {percentile === 50 ? labels.median : `P${percentile}`}
                  </TableHead>
                  {series.map((item, index) => (
                    <TableCell numeric key={index}>
                      {item.distribution ? format(item.distribution.percentiles[percentile]!) : '—'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

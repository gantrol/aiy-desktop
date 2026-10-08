import { useId, useMemo } from 'react';
import { formatCodexHistoryDuration } from '@/renderer/features/extensions/CodexHistoryThreadTiming';
import {
  codexTurnDurationComparison,
  type CodexDurationComparisonRows,
} from '@/renderer/features/extensions/codexTurnDurationComparison';
import { useI18n } from '@/renderer/i18n/useI18n';

const PERCENTILES = [0, 25, 50, 75, 100] as const;
const PLOT = { width: 258, height: 90 };

function SeriesMark({ dashed }: { dashed: boolean }) {
  return (
    <svg width="22" height="10" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        x2="22"
        y1="5"
        y2="5"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dashed ? '5 3' : undefined}
      />
    </svg>
  );
}

export function CodexTurnDurationPercentiles({
  rows,
  numbers,
}: {
  rows: CodexDurationComparisonRows;
  numbers: Intl.NumberFormat;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { locale, messages } = useI18n();
  const labels = messages.extensions.codexUsageInvestigator;
  const [firstRow, secondRow] = rows;
  const comparison = useMemo(() => codexTurnDurationComparison([firstRow, secondRow]), [firstRow, secondRow]);
  if (comparison.status !== 'ready')
    return (
      <p className="text-muted-foreground">
        {comparison.status === 'empty' ? labels.evidence.noData : labels.evidence.durationSamplesMissing}
      </p>
    );
  const { series } = comparison;

  const cohort = series[0]!.row;
  const effortKey = cohort.reasoningEffort as keyof typeof messages.aiCenter.routing.reasoningEfforts;
  const effort = cohort.reasoningEffort
    ? (messages.aiCenter.routing.reasoningEfforts[effortKey] ?? cohort.reasoningEffort)
    : labels.modelComparison.unknownEffort;
  const maximum = Math.max(...series.map((item) => item.distribution?.percentiles[100] ?? 0));
  const ticks = [1, 0.5, 0].map((fraction) => ({
    fraction,
    value: maximum * fraction,
  }));
  const x = (percentile: number) => (PLOT.width * percentile) / 100;
  const y = (value: number) => PLOT.height * (1 - value / (maximum || 1));
  const duration = (value: number | null) => formatCodexHistoryDuration(value, locale);
  const change = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });

  return (
    <div className="grid min-w-0 gap-2">
      <p className="min-w-0 truncate font-mono" title={`${cohort.model} · ${effort}`}>
        {cohort.model} · {effort}
      </p>
      <div className="grid min-w-0 gap-1">
        {series.map((item) => (
          <div
            key={item.row.serviceTier}
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 tabular-nums"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <SeriesMark dashed={item.row.serviceTier === 'FAST'} />
              {labels.modelComparison.modes[item.row.serviceTier]}
            </span>
            <span className="flex flex-wrap justify-end gap-x-1">
              <span className="whitespace-nowrap">
                P50 {duration(item.distribution?.percentiles[50] ?? null)} ·{' '}
                {numbers.format(item.distribution?.sampleCount ?? 0)} {labels.turnSpeed.turns}
              </span>
              <span className="whitespace-nowrap text-muted-foreground">
                · {labels.evidence.durationExcluded} {numbers.format(item.excludedCount)} {labels.turnSpeed.turns}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 tabular-nums">
        <span className="text-[10px] text-muted-foreground">
          {labels.evidence.durationCutoff} {duration(comparison.upperFenceMs)}
        </span>
        {comparison.medianChange !== null && (
          <span className="font-medium">
            {labels.evidence.durationFastMedianChange} {change.format(comparison.medianChange)}
          </span>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-2 gap-y-2 py-2">
        <div className="grid grid-rows-[0_1fr_0] text-right text-[10px] leading-tight text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick.fraction} className="self-center break-words">
              {duration(tick.value)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          className="block h-auto w-full min-w-0 overflow-visible text-foreground"
        >
          <title id={titleId}>
            {labels.evidence.quantiles} · {labels.modelComparison.metrics.durationMs}
          </title>
          <desc id={descriptionId}>{labels.evidence.durationNote}</desc>
          {ticks.map((tick) => (
            <line
              key={tick.fraction}
              x1="0"
              x2={PLOT.width}
              y1={PLOT.height * (1 - tick.fraction)}
              y2={PLOT.height * (1 - tick.fraction)}
              className="stroke-border"
            />
          ))}
          {series.map(
            (item) =>
              item.distribution && (
                <polyline
                  key={item.row.serviceTier}
                  points={item.distribution.percentiles
                    .map((value, percentile) => `${x(percentile)},${y(value)}`)
                    .join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={item.row.serviceTier === 'FAST' ? '5 4' : undefined}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ),
          )}
          {series.map(
            (item) =>
              item.distribution && (
                <circle
                  key={`${item.row.serviceTier}:p50`}
                  cx={x(50)}
                  cy={y(item.distribution.percentiles[50]!)}
                  r="2.75"
                  fill={item.row.serviceTier === 'FAST' ? 'var(--background)' : 'currentColor'}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              ),
          )}
        </svg>
        <div className="relative col-start-2 h-4 text-[10px] text-muted-foreground">
          {PERCENTILES.map((percentile) => (
            <span
              key={percentile}
              className="absolute"
              style={{
                left: `${percentile}%`,
                transform: `translateX(${percentile === 0 ? 0 : percentile === 100 ? -100 : -50}%)`,
              }}
            >
              P{percentile}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

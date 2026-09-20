import { useId, useMemo } from 'react';
import { empiricalSteps, type CodexSampleSummary } from '@/shared/codex-usage-evidence';
import { Badge } from '@/renderer/components/ui/badge';
import {
  displayCodexModelChartSamples,
  type CodexModelChartGroup,
} from '@/renderer/features/extensions/codexModelComparisonChart';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import type { useI18n } from '@/renderer/i18n/useI18n';

type EvidenceLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['evidence'];

const PLOT = { left: 44, top: 16, width: 520, height: 152 };

export function CodexModelEvidenceChart({
  summaries,
  groups,
  view,
  format,
  label,
  text,
}: {
  summaries: readonly [CodexSampleSummary, CodexSampleSummary];
  groups: readonly [readonly CodexModelChartGroup[], readonly CodexModelChartGroup[]];
  view: 'points' | 'cumulative';
  format(value: number): string;
  label: string;
  text: EvidenceLabels;
}) {
  const id = useId();
  const samples = useMemo(
    () => [displayCodexModelChartSamples(groups[0]), displayCodexModelChartSamples(groups[1])] as const,
    [groups],
  );
  const maximum = Math.max(...summaries.map((summary) => summary.values.at(-1) ?? 0)) || 1;
  const x = (value: number) => PLOT.left + (value / maximum) * PLOT.width;
  const y = (percent: number) => PLOT.top + PLOT.height * (1 - percent / 100);
  if (summaries.every((summary) => !summary.valid))
    return <p className="text-sm text-muted-foreground">{text.noData}</p>;
  const caption = view === 'points' ? text.chartNote : text.cumulativeNote;
  return (
    <figure className="grid min-w-0 gap-2">
      <svg
        viewBox="0 0 608 224"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        className="block h-auto w-full max-w-3xl text-foreground"
      >
        <title id={`${id}-title`}>
          {text[view]} · {label}
        </title>
        <desc id={`${id}-description`}>{caption}</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={x(maximum * fraction)}
              x2={x(maximum * fraction)}
              y1={PLOT.top}
              y2={PLOT.top + PLOT.height}
              className="stroke-border"
            />
            <text
              x={x(maximum * fraction)}
              y={PLOT.top + PLOT.height + 22}
              textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px]"
            >
              {format(maximum * fraction)}
            </text>
            {view === 'cumulative' && (
              <text
                x={PLOT.left - 8}
                y={y(fraction * 100)}
                textAnchor="end"
                dy="0.3em"
                className="fill-muted-foreground text-[10px]"
              >
                {fraction * 100}%
              </text>
            )}
          </g>
        ))}
        {summaries.map((summary, index) => {
          if (!summary.valid) return null;
          if (view === 'cumulative') {
            const steps = empiricalSteps(summary.values);
            const path = [
              `M ${PLOT.left} ${y(0)}`,
              ...steps.map((step) => `H ${x(step.value)} V ${y(step.percent)}`),
              `H ${x(maximum)}`,
            ].join(' ');
            return (
              <g key={index}>
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={index ? '5 4' : undefined}
                />
                {samples[index].map((sample) => (
                  <circle
                    key={sample.key}
                    cx={x(sample.value)}
                    cy={y(sample.cumulativePercent)}
                    r="2.25"
                    fill={index ? 'none' : 'currentColor'}
                    stroke="currentColor"
                    strokeWidth="1.25"
                    opacity="0.75"
                    style={{ color: sample.configuration.color }}
                  >
                    <title>
                      {index ? 'B' : 'A'} · {sample.configuration.label} · {format(sample.value)}
                    </title>
                  </circle>
                ))}
              </g>
            );
          }
          const baseline = PLOT.top + (index ? 111 : 44);
          return (
            <g key={index}>
              <text x={PLOT.left - 12} y={baseline + 4} textAnchor="end" className="fill-foreground text-xs">
                {index ? 'B' : 'A'}
              </text>
              <line
                x1={x(summary.p25!)}
                x2={x(summary.p75!)}
                y1={baseline + 20}
                y2={baseline + 20}
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeWidth="10"
              />
              <line
                x1={x(summary.p50!)}
                x2={x(summary.p50!)}
                y1={baseline + 12}
                y2={baseline + 28}
                stroke="currentColor"
                strokeWidth="2"
              />
              {samples[index].map((sample, point) => (
                <circle
                  key={sample.key}
                  cx={x(sample.value)}
                  cy={baseline + ((point % 5) - 2) * 3}
                  r="2.5"
                  fill={index ? 'none' : 'currentColor'}
                  stroke="currentColor"
                  strokeWidth="1.25"
                  opacity="0.65"
                  style={{ color: sample.configuration.color }}
                >
                  <title>
                    {index ? 'B' : 'A'} · {sample.configuration.label} · {format(sample.value)}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        <text x={PLOT.left + PLOT.width / 2} y="215" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {label}
        </text>
      </svg>
      <figcaption className="flex items-center gap-1">
        <CodexUsageEvidenceHelp label={caption}>{caption}</CodexUsageEvidenceHelp>
        {summaries.some((summary) => summary.valid > 200) && (
          <>
            <Badge variant="outline">{text.drawingReduced}</Badge>
            <CodexUsageEvidenceHelp label={text.drawingLimited}>{text.drawingLimited}</CodexUsageEvidenceHelp>
          </>
        )}
      </figcaption>
    </figure>
  );
}

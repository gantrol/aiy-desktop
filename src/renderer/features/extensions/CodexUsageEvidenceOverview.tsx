import { useMemo, type ReactNode } from 'react';
import { CircleDollarSignIcon, GaugeIcon, SearchIcon, TimerIcon } from 'lucide-react';
import type { CodexUsageInvestigation } from '@/shared/contracts/codex-usage';
import { bestSupportedSpeedComparison, evidencePercent, recordedModeCoverage } from '@/shared/codex-usage-evidence';
import { Button } from '@/renderer/components/ui/button';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import { CodexUsagePurityOverview } from '@/renderer/features/extensions/CodexUsagePurity';
import { useI18n } from '@/renderer/i18n/useI18n';

export type CodexUsageDetailTopic = 'money' | 'quota' | 'speed' | 'records' | 'sessions';
export interface CodexEvidenceFormatters {
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}

function OverviewCard({
  title,
  icon,
  children,
  onInspect,
  action,
  note,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onInspect(): void;
  action: string;
  note?: string;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-2 border-b px-3 py-4 @3xl/codex-usage:border">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        {note && <CodexUsageEvidenceHelp label={note}>{note}</CodexUsageEvidenceHelp>}
      </h3>
      <div className="grid min-w-0 flex-1 content-start gap-2 text-xs">{children}</div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 justify-self-start self-start px-0"
        onClick={onInspect}
        aria-label={`${title} · ${action}`}
      >
        {action}
      </Button>
    </article>
  );
}

export function CodexUsageEvidenceOverview({
  investigation,
  formatters,
  onInspect,
  quotaSamplingControl,
}: {
  investigation: CodexUsageInvestigation;
  formatters: CodexEvidenceFormatters;
  onInspect(topic: CodexUsageDetailTopic): void;
  quotaSamplingControl: ReactNode;
}) {
  const { messages } = useI18n();
  const labels = messages.extensions.codexUsageInvestigator;
  const text = labels.evidence;
  const { numbers, tokens, money } = formatters;
  const totals = investigation.totals;
  const percent = (value: number | null) => (value === null ? '—' : `${numbers.format(value)}%`);
  const primary = bestSupportedSpeedComparison(investigation.turnSpeed?.comparisons ?? []);
  const modeCoverage = recordedModeCoverage(investigation.models, totals.totalTokens);
  const chart = useMemo(() => {
    const sorted = [...investigation.days].sort((a, b) => a.date.localeCompare(b.date));
    const size = Math.max(1, Math.ceil(sorted.length / 24));
    const buckets: { label: string; value: number | null }[] = [];
    for (let index = 0; index < sorted.length; index += size) {
      const days = sorted.slice(index, index + size);
      const priced = days.filter((day) => day.apiEquivalentUsd !== null);
      buckets.push({
        label: `${days[0]!.date} – ${days.at(-1)!.date}`,
        value: priced.length ? priced.reduce((sum, day) => sum + day.apiEquivalentUsd!, 0) : null,
      });
    }
    return buckets;
  }, [investigation.days]);
  const maximum = Math.max(1, ...chart.map((bucket) => bucket.value ?? 0));
  const maximumDuration = Math.max(1, primary?.standard.medianDurationMs ?? 0, primary?.fast.medianDurationMs ?? 0);
  return (
    <section
      className="grid min-w-0 gap-3 @3xl/codex-usage:grid-cols-2 @6xl/codex-usage:grid-cols-4"
      aria-label={text.glance}
    >
      <OverviewCard
        title={text.money}
        icon={<CircleDollarSignIcon aria-hidden="true" className="size-4" />}
        action={text.inspect}
        note={text.moneyNote}
        onInspect={() => onInspect('money')}
      >
        <p className="text-xl font-semibold tabular-nums">
          {totals.apiEquivalentUsd === null ? '—' : `≈${money.format(totals.apiEquivalentUsd)}`}
        </p>
        <p>{text.subtotal}</p>
        <p className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            {text.cacheSavings}
            <CodexUsageEvidenceHelp label={text.cacheSavingsNote}>{text.cacheSavingsNote}</CodexUsageEvidenceHelp>
          </span>
          <span className="font-semibold tabular-nums">
            {totals.apiCacheSavingsUsd === null ? '—' : money.format(totals.apiCacheSavingsUsd)}
          </span>
        </p>
        <p>
          {labels.metrics.cachedInput}: {tokens.format(totals.cachedInputTokens)}
        </p>
        <p>
          {text.coverage}: {tokens.format(totals.apiPricedTokens)} / {tokens.format(totals.totalTokens)} ·{' '}
          {percent(evidencePercent(totals.apiPricedTokens, totals.totalTokens))}
        </p>
        {chart.length > 0 && (
          <svg viewBox="0 0 240 44" role="img" aria-label={text.daily} className="h-11 w-full text-foreground">
            {chart.map((bucket, index) => (
              <rect
                key={bucket.label}
                x={(index * 240) / chart.length}
                y={bucket.value === null ? 42 : 42 - (bucket.value / maximum) * 40}
                width={Math.max(1, 240 / chart.length - 2)}
                height={bucket.value === null ? 1 : Math.max(1, (bucket.value / maximum) * 40)}
                fill="currentColor"
                opacity={bucket.value === null ? 0.15 : 0.65}
              >
                <title>
                  {bucket.label} · {bucket.value === null ? text.noData : money.format(bucket.value)}
                </title>
              </rect>
            ))}
          </svg>
        )}
      </OverviewCard>
      <OverviewCard
        title={text.quota}
        icon={<GaugeIcon aria-hidden="true" className="size-4" />}
        action={text.inspect}
        onInspect={() => onInspect('quota')}
      >
        {quotaSamplingControl}
        <CodexUsagePurityOverview investigation={investigation} formatters={formatters} />
      </OverviewCard>
      <OverviewCard
        title={text.speed}
        icon={<TimerIcon aria-hidden="true" className="size-4" />}
        action={text.inspect}
        note={`${text.speedNote} ${text.sampleNote}`}
        onInspect={() => onInspect('speed')}
      >
        {primary ? (
          <>
            <p className="break-words font-mono">
              {primary.model} · {primary.reasoningEffort}
            </p>
            {(['standard', 'fast'] as const).map((tier) => (
              <div key={tier} className="grid gap-1">
                <p className="flex flex-wrap justify-between gap-2">
                  <span>{tier === 'fast' ? 'Fast' : 'Standard'}</span>
                  <span>
                    {primary[tier].medianDurationMs === null
                      ? '—'
                      : `${numbers.format(primary[tier].medianDurationMs / 1_000)} ${labels.turnSpeed.units.seconds}`}{' '}
                    · n={numbers.format(primary[tier].completedTurnCount)}
                  </span>
                </p>
                <div className="h-1.5 bg-muted" aria-hidden="true">
                  <div
                    className="h-full bg-foreground/60"
                    style={{ width: `${((primary[tier].medianDurationMs ?? 0) / maximumDuration) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <p>{text.median}</p>
          </>
        ) : (
          <p>{text.noData}</p>
        )}
        <p>{text.generationMissing}</p>
      </OverviewCard>
      <OverviewCard
        title={text.records}
        icon={<SearchIcon aria-hidden="true" className="size-4" />}
        action={text.inspect}
        note={text.recordsNote}
        onInspect={() => onInspect('records')}
      >
        <p className="text-base font-semibold">
          {text.explicitMode}: {percent(modeCoverage.explicit)}
        </p>
        <p>
          {text.inferredMode}: {percent(modeCoverage.inferred)}
        </p>
        <p>
          {text.unknownMode}: {percent(modeCoverage.unknown)}
        </p>
        <p>
          {text.invalid}: {numbers.format(investigation.relevantInvalidRecords)} · {text.skipped}:{' '}
          {numbers.format(investigation.filesSkipped)}
        </p>
      </OverviewCard>
    </section>
  );
}

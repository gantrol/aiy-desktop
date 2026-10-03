import type { CodexHistoryThreadUsage } from '@/shared/contracts/codex-history-search';
import { useI18n } from '@/renderer/i18n/useI18n';

export function formatCodexHistoryDuration(milliseconds: number | null, locale: string) {
  if (milliseconds === null) return '—';
  const seconds = Math.round(milliseconds / 100) / 10;
  const units = [
    ['hour', Math.floor(seconds / 3_600)],
    ['minute', Math.floor((seconds % 3_600) / 60)],
    ['second', Math.round((seconds % 60) * 10) / 10],
  ] as const;
  return units
    .filter(([unit, value]) => value > 0 || (seconds === 0 && unit === 'second'))
    .map(([unit, value]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value))
    .join(' ');
}

export function CodexHistoryThreadTiming({ usage }: { usage: CodexHistoryThreadUsage }) {
  const { locale, messages } = useI18n();
  const labels = messages.extensions.codexHistorySearch.usage;
  const timing = usage.timing;
  const count = new Intl.NumberFormat(locale);
  const duration = (value: number | null) => formatCodexHistoryDuration(value, locale);
  const rows = [
    [labels.turnCount, count.format(timing.turnCount)],
    [labels.completedTurns, count.format(timing.completedTurnCount)],
    [labels.abortedTurns, count.format(timing.abortedTurnCount)],
    [labels.unfinishedTurns, count.format(timing.unfinishedTurnCount)],
    [labels.timedTurns, `${count.format(timing.timedTurnCount)} / ${count.format(timing.turnCount)}`],
    [
      labels.averageDuration,
      duration(timing.timedTurnCount ? (timing.totalDurationMs ?? 0) / timing.timedTurnCount : null),
    ],
    [labels.longestDuration, duration(timing.longestTurnDurationMs)],
    [labels.compactions, count.format(usage.contextCompactionCount)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-2">
          <dt>{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

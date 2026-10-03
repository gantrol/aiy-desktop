import type { CodexOutputThroughput } from '@/shared/contracts/codex-output-throughput';
import { codexOutputTokensPerSecond } from '@/shared/codex-output-throughput';
import { formatCodexHistoryDuration } from '@/renderer/features/extensions/CodexHistoryThreadTiming';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CodexOutputThroughputValue({
  throughput,
  label = false,
}: {
  throughput: CodexOutputThroughput | null | undefined;
  label?: boolean;
}) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexThroughput;
  const rate = codexOutputTokensPerSecond(throughput);
  const value = rate === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rate);
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={`${l.turn}: ${l.note}${throughput?.partial ? ` ${l.partial}` : ''}`}
    >
      {label && `${l.turn} `}
      {value} {l.unit}
      {throughput?.partial && <span aria-label={l.partial}> *</span>}
    </span>
  );
}

export function CodexOutputThroughputDetails({ throughput }: { throughput: CodexOutputThroughput | null | undefined }) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexThroughput;
  const numbers = new Intl.NumberFormat(locale);
  const count = (value: number | undefined) => (value === undefined ? '—' : numbers.format(value));
  const rows = [
    [l.generation, l.unmeasured],
    [
      l.coverage,
      throughput
        ? `${count(throughput.pairedTurnCount)} / ${count(throughput.completedTurnCount + throughput.abortedTurnCount)}`
        : '—',
    ],
    [l.output, count(throughput?.pairedTurnCount ? throughput.outputTokens : undefined)],
    [l.duration, formatCodexHistoryDuration(throughput?.pairedTurnCount ? throughput.durationMs : null, locale)],
    [l.completed, count(throughput?.completedTurnCount)],
    [l.aborted, count(throughput?.abortedTurnCount)],
    [l.missingUsage, count(throughput?.missingUsageTurnCount)],
    [l.invalidDuration, count(throughput?.invalidDurationTurnCount)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap justify-between gap-x-2"
          title={label === l.generation ? l.generationNote : undefined}
        >
          <dt>{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

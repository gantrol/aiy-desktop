import type { CodexModelChartConfiguration } from '@/renderer/features/extensions/codexModelComparisonChart';

export function CodexModelComparisonChartLegend({
  configurations,
  label,
}: {
  configurations: readonly CodexModelChartConfiguration[];
  label: string;
}) {
  if (configurations.length < 2) return null;
  return (
    <div role="list" aria-label={label} className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
      {configurations.map((configuration) => (
        <span key={configuration.key} role="listitem" className="flex min-w-0 items-center gap-1.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            className="shrink-0"
            style={{ color: configuration.color }}
          >
            <circle cx="5" cy="5" r="3.5" fill="currentColor" />
          </svg>
          <span className="break-all font-mono">{configuration.label}</span>
        </span>
      ))}
    </div>
  );
}

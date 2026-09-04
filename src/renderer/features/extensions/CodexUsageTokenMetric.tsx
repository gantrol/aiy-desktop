import { useState } from 'react';
import { ArrowLeftRightIcon, ZapIcon } from 'lucide-react';
import type { CodexUsageInvestigation } from '@/shared/contracts';
import { codexUsageNonFastTokensPerFullQuota } from '@/shared/codex-usage-quota';
import { Button } from '@/renderer/components/ui/button';
import { CodexUsagePulseMetric } from '@/renderer/features/extensions/CodexUsagePulseMetric';
import { formatCodexUsageTokenRange } from '@/renderer/features/extensions/codexUsageTokenRange';
import type { useI18n } from '@/renderer/i18n/useI18n';

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

function modelScopeNote(
  quota: NonNullable<ReturnType<typeof codexUsageNonFastTokensPerFullQuota>>,
  labels: UsageLabels,
  numbers: Intl.NumberFormat,
) {
  const share = (tokens: number) => `${numbers.format((tokens / quota.observedTokens) * 100)}%`;
  const models = quota.models.slice(0, 8).map((entry) => `${entry.model} ${share(entry.tokens)}`);
  if (quota.models.length > 8) {
    const remainingTokens = quota.models.slice(8).reduce((sum, entry) => sum + entry.tokens, 0);
    models.push(`${labels.overview.quotaOtherModels} (${quota.models.length - 8}) ${share(remainingTokens)}`);
  }
  const unclassifiedTokens = quota.observedTokens - quota.models.reduce((sum, entry) => sum + entry.tokens, 0);
  if (unclassifiedTokens > 0) models.push(`${labels.overview.quotaUnclassifiedModel} ${share(unclassifiedTokens)}`);
  return `${labels.overview.quotaModels}: ${models.join(', ')}`;
}

export function CodexUsageTokenMetric({
  investigation,
  labels,
  tokens,
  numbers,
  date,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  tokens: Intl.NumberFormat;
  numbers: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}) {
  const [equivalent, setEquivalent] = useState(false);
  const quota = codexUsageNonFastTokensPerFullQuota(investigation.quotaYield);
  const currentLabel = equivalent ? labels.overview.normalQuotaEquivalent : labels.metrics.totalTokens;
  const nextLabel = equivalent ? labels.metrics.totalTokens : labels.overview.normalQuotaEquivalent;
  const quotaNote = [
    labels.overview.normalQuotaScope,
    labels.overview.normalQuotaNote,
    ...(quota
      ? [
          `${labels.overview.quotaObservedTokens}: ${tokens.format(quota.observedTokens)}`,
          ...(quota.observedFrom && quota.observedTo
            ? [
                `${labels.overview.quotaObservedPeriod}: ${date.format(new Date(quota.observedFrom))} – ${date.format(new Date(quota.observedTo))}`,
              ]
            : []),
          modelScopeNote(quota, labels, numbers),
          `${labels.overview.knownMode} ${numbers.format(quota.coveragePercent)}%`,
          `${labels.quotaYield.quotaPoints} ${numbers.format(quota.quotaPercent)}%`,
          ...(quota.partial ? [labels.overview.partialQuota] : []),
          ...(quota.legacy ? [labels.overview.legacyQuota] : []),
        ]
      : [labels.overview.normalQuotaUnavailable]),
  ].join('\n\n');
  const reportFrom = investigation.from ?? investigation.quotaYield?.storedFrom;
  const totalNote = [
    labels.overview.totalTokensNote,
    `${labels.overview.reportPeriod}: ${reportFrom ? date.format(new Date(reportFrom)) : labels.ranges.ALL} – ${date.format(new Date(investigation.to))}`,
  ].join('\n\n');
  const equivalentValue = quota
    ? formatCodexUsageTokenRange(quota.minimumTokensPerFullQuota, quota.maximumTokensPerFullQuota, tokens)
    : '—';
  return (
    <CodexUsagePulseMetric
      icon={<ZapIcon />}
      label={
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className="-my-1 h-auto min-w-0 max-w-full gap-1 px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label={`${currentLabel} → ${nextLabel}`}
          onClick={() => setEquivalent((value) => !value)}
        >
          <span className="truncate">{currentLabel}</span>
          <ArrowLeftRightIcon aria-hidden className="size-3" />
        </Button>
      }
      value={equivalent ? equivalentValue : tokens.format(investigation.totals.totalTokens)}
      note={equivalent ? quotaNote : totalNote}
    />
  );
}

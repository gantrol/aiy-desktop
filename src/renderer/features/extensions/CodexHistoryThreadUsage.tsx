import { useEffect, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { CodexHistoryThreadUsage as Usage } from '@/shared/contracts/codex-history-search';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import {
  CodexHistoryThreadTiming,
  formatCodexHistoryDuration,
} from '@/renderer/features/extensions/CodexHistoryThreadTiming';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CodexOutputThroughputDetails,
  CodexOutputThroughputValue,
} from '@/renderer/features/extensions/CodexOutputThroughput';

const TOKEN_BREAKDOWN_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
] as const;

type ThroughputListener = (threadId: string, updatedAt: string, throughput: Usage['throughput']) => void;

function useThreadUsage(threadId: string, updatedAt: string, onThroughput?: ThroughputListener) {
  // Undefined is pending; null is a completed cancellation.
  const [usage, setUsage] = useState<Usage | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setUsage(undefined);
    setError(false);
    void window.desktopApi.codexHistoryThreadUsage({ threadId }).then(
      (result) => {
        if (current) {
          setUsage(result);
          if (result) onThroughput?.(threadId, updatedAt, result.throughput);
        }
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
      void window.desktopApi.codexHistoryThreadUsageCancel({ threadId }).catch(() => undefined);
    };
  }, [threadId, updatedAt, onThroughput]);
  return { usage, error };
}

function summarizeThreadUsage(models: Usage['models']) {
  const totals = { totalTokens: 0, apiPricedTokens: 0, apiEquivalentUsd: 0, creditPricedTokens: 0, codexCredits: 0 };
  for (const model of models) {
    totals.totalTokens += model.totalTokens;
    totals.apiPricedTokens += model.apiPricedTokens;
    totals.apiEquivalentUsd += model.apiEquivalentUsd ?? 0;
    totals.creditPricedTokens += model.creditPricedTokens;
    totals.codexCredits += model.codexCredits ?? 0;
  }
  return totals;
}

function UsagePriceSummary({
  label,
  amount,
  pricedTokens,
  totalTokens,
  formatter,
}: {
  label: string;
  amount: number;
  pricedTokens: number;
  totalTokens: number;
  formatter: Intl.NumberFormat;
}) {
  const labels = useI18n().messages.extensions.codexHistorySearch.usage;
  return (
    <span>
      {label} {pricedTokens > 0 ? `≈ ${formatter.format(amount)}` : '—'}
      {pricedTokens < totalTokens && <span className="ml-2 text-muted-foreground">{labels.partialPricing}</span>}
    </span>
  );
}

export function CodexHistoryThreadUsage({
  threadId,
  updatedAt,
  onThroughput,
}: {
  threadId: string;
  updatedAt: string;
  onThroughput?: ThroughputListener;
}) {
  const { locale, messages } = useI18n();
  const labels = messages.extensions.codexHistorySearch.usage;
  const { usage, error } = useThreadUsage(threadId, updatedAt, onThroughput);
  if (usage === null) return null;
  if (!usage)
    return (
      <div role="status" className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
        {error ? labels.unavailable : labels.loading}
      </div>
    );
  if (!usage.models.length && !usage.timing.turnCount && !usage.contextCompactionCount)
    return <div className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">{labels.noUsage}</div>;

  const compactTokens = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const exactTokens = new Intl.NumberFormat(locale);
  const creditAmount = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const usdAmount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const totals = summarizeThreadUsage(usage.models);
  return (
    <Collapsible key={threadId} className="flex min-h-0 max-h-[40%] shrink-0 flex-col border-b text-xs">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 leading-6">
        <CodexOutputThroughputValue throughput={usage.throughput} label />
        <span className="font-medium tabular-nums" title={labels.durationNote}>
          {labels.executionTime} {formatCodexHistoryDuration(usage.timing.totalDurationMs, locale)}
          {usage.timing.partial && <span className="ml-2 text-muted-foreground">{labels.partialTiming}</span>}
        </span>
        <span title={exactTokens.format(totals.totalTokens)} className="tabular-nums">
          {labels.totalTokens} {usage.models.length ? compactTokens.format(totals.totalTokens) : '—'}
        </span>
        <span title={labels.note}>
          <UsagePriceSummary
            label={labels.codexCredits}
            amount={totals.codexCredits}
            pricedTokens={totals.creditPricedTokens}
            totalTokens={totals.totalTokens}
            formatter={creditAmount}
          />
        </span>
        {usage.partial && <span className="text-muted-foreground">{labels.partial}</span>}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="group ml-auto">
            {labels.details}
            <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="min-h-0 overflow-y-auto px-4 pb-3">
        <div className="space-y-3 border-t pt-2">
          <CodexHistoryThreadTiming usage={usage} />
          <CodexOutputThroughputDetails throughput={usage.throughput} />
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-x-2">
              <dt>{labels.apiEquivalent}:</dt>
              <dd>{totals.apiPricedTokens > 0 ? `≈ ${usdAmount.format(totals.apiEquivalentUsd)}` : '—'}</dd>
            </div>
            <div className="flex gap-x-2">
              <dt>{labels.coverage}:</dt>
              <dd>{totals.totalTokens > 0 ? percent.format(totals.apiPricedTokens / totals.totalTokens) : '—'}</dd>
            </div>
            <div className="flex gap-x-2">
              <dt>{labels.creditCoverage}:</dt>
              <dd>{totals.totalTokens > 0 ? percent.format(totals.creditPricedTokens / totals.totalTokens) : '—'}</dd>
            </div>
          </dl>
          {usage.models.map((row) => (
            <div key={row.model} className="space-y-1 border-t pt-2">
              <div className="flex flex-wrap justify-between gap-2 font-medium">
                <span>{row.model}</span>
                <span>
                  {labels.codexCredits} {row.codexCredits === null ? '—' : `≈ ${creditAmount.format(row.codexCredits)}`}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <div className="flex flex-wrap justify-between gap-x-2">
                  <dt>{labels.apiEquivalent}</dt>
                  <dd>{row.apiEquivalentUsd === null ? '—' : `≈ ${usdAmount.format(row.apiEquivalentUsd)}`}</dd>
                </div>
                {TOKEN_BREAKDOWN_FIELDS.map((key) => (
                  <div key={key} className="flex flex-wrap justify-between gap-x-2">
                    <dt>{labels[key]}</dt>
                    <dd>{exactTokens.format(row[key])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

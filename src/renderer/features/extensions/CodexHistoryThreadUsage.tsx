import { useEffect, useState } from 'react';
import type { CodexHistoryThreadUsage as Usage } from '@/shared/contracts/codex-history-search';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CodexHistoryThreadUsage({ threadId, updatedAt }: { threadId: string; updatedAt: string }) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexHistorySearch.usage;
  // Undefined is pending; null is a completed cancellation.
  const [value, setValue] = useState<Usage | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setValue(undefined);
    setError(false);
    void window.desktopApi.codexHistoryThreadUsage({ threadId }).then(
      (result) => {
        if (current) setValue(result);
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
      void window.desktopApi.codexHistoryThreadUsageCancel({ threadId }).catch(() => undefined);
    };
  }, [threadId, updatedAt]);
  const tokens = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const exact = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
  if (value === null) return null;
  if (!value)
    return (
      <div role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
        {error ? l.unavailable : l.loading}
      </div>
    );
  if (!value.models.length) return <div className="border-b px-4 py-2 text-xs text-muted-foreground">{l.noUsage}</div>;
  const total = value.models.reduce((sum, row) => sum + row.totalTokens, 0);
  const priced = value.models.reduce((sum, row) => sum + row.apiPricedTokens, 0);
  const cost = value.models.reduce((sum, row) => sum + (row.apiEquivalentUsd ?? 0), 0);
  return (
    <details key={threadId} className="max-h-72 shrink-0 overflow-y-auto border-b px-4 py-2 text-xs">
      <summary className="cursor-pointer leading-6">
        <span title={exact.format(total)} className="font-medium">
          {tokens.format(total)} tokens
        </span>
        {' · '}
        {l.apiEquivalent} {priced ? `≈ ${money.format(cost)}` : '—'}
        {priced < total && <span className="ml-2 text-muted-foreground">{l.partialPricing}</span>}
        {value.partial && <span className="ml-2 text-muted-foreground">{l.partial}</span>}
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-muted-foreground">{l.note}</p>
        <p>
          {l.coverage}:{' '}
          {new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(priced / total)}
        </p>
        {value.models.map((row) => (
          <div key={row.model} className="space-y-1 border-t pt-2">
            <div className="flex flex-wrap justify-between gap-2 font-medium">
              <span>{row.model}</span>
              <span>{row.apiEquivalentUsd === null ? '—' : `≈ ${money.format(row.apiEquivalentUsd)}`}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
              {(
                [
                  'inputTokens',
                  'cachedInputTokens',
                  'cacheWriteInputTokens',
                  'outputTokens',
                  'reasoningOutputTokens',
                ] as const
              ).map((key) => (
                <div key={key} className="flex flex-wrap justify-between gap-x-2">
                  <dt>{l[key]}</dt>
                  <dd>{exact.format(row[key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}

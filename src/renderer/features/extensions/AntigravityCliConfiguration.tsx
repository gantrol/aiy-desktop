import { GaugeIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { AntigravityCliStatusDto } from '@/shared/contracts';

interface Props {
  active: boolean;
  onConnectionChanged(): void | Promise<void>;
}

export function AntigravityCliConfiguration({ active, onConnectionChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.antigravityCli;
  const [status, setStatus] = useState<AntigravityCliStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connectionChangedRef = useRef(onConnectionChanged);

  useEffect(() => {
    connectionChangedRef.current = onConnectionChanged;
  }, [onConnectionChanged]);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    setError('');
    try {
      const cached = await window.desktopApi.antigravityCliGet();
      setStatus(cached);
      if (refresh) {
        setStatus(await window.desktopApi.antigravityCliRefresh());
        await connectionChangedRef.current();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load(true);
  }, [active, load]);

  const state = status?.state ?? 'checking';
  const warning = status?.quota.warning ?? 'UNAVAILABLE';
  const localeTag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const checkedAt = status?.quota.checkedAt ? new Date(status.quota.checkedAt).toLocaleString(localeTag) : l.notChecked;

  return (
    <section data-antigravity-cli-configuration className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <GaugeIcon className="size-4" />
        <h3 className="text-sm font-semibold">{l.title}</h3>
        <Badge className="ml-auto" variant={state === 'ready' ? 'default' : 'outline'}>
          {l.states[state]}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={l.refresh}
          title={l.refresh}
          disabled={busy}
          onClick={() => void load(true)}
        >
          <RefreshCwIcon className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      </header>
      <div className="grid gap-4 p-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-surface-sunken/55 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">{l.version}</dt>
          <dd className="text-right font-mono">{status?.version || '—'}</dd>
          <dt className="text-muted-foreground">{l.currentModel}</dt>
          <dd className="truncate text-right font-mono">{status?.currentModel?.name ?? '—'}</dd>
          <dt className="text-muted-foreground">{l.lastChecked}</dt>
          <dd className="text-right">{checkedAt}</dd>
        </dl>

        {warning !== 'NONE' && (
          <p
            role="status"
            className={cn(
              'rounded-md px-3 py-2 text-xs',
              warning === 'LOW' && 'bg-warning-surface text-warning',
              warning === 'EXHAUSTED' && 'bg-destructive-surface text-destructive',
              warning === 'UNAVAILABLE' && 'bg-muted text-muted-foreground',
            )}
          >
            {l.warnings[warning]}
          </p>
        )}

        {status?.quota.groups.map((group, groupIndex) => (
          <section key={`${group.name}:${groupIndex}`} className="grid gap-2">
            <div>
              <h4 className="text-xs font-medium">{group.name}</h4>
              {group.description && <p className="text-xs text-muted-foreground">{group.description}</p>}
            </div>
            {group.buckets.map((bucket) => {
              const percent = Math.round(bucket.remainingFraction * 100);
              return (
                <div key={bucket.id} className="grid gap-1.5 rounded-md border px-3 py-2 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">{bucket.name}</span>
                    <strong className="tabular-nums">{percent}%</strong>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        percent <= 0 ? 'bg-destructive' : percent <= 20 ? 'bg-warning' : 'bg-primary',
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between gap-3 text-muted-foreground">
                    <span>{bucket.window}</span>
                    <span>
                      {l.resetAt}: {bucket.resetAt ? new Date(bucket.resetAt).toLocaleString(localeTag) : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        {status?.message && <p className="text-xs text-muted-foreground">{status.message}</p>}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

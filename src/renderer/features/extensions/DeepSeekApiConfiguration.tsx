import { KeyRoundIcon, LoaderCircleIcon, PlugZapIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { loadProviderConnection } from '@/renderer/features/extensions/providerConnectionClient';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ProviderConnectionDto } from '@/shared/contracts';
import { DEEPSEEK_API_CONNECTION_ID } from '@/shared/extension-ids';

interface Props {
  active: boolean;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

export function DeepSeekApiConfiguration({ active, notify, onConnectionChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.deepSeekApi;
  const [connection, setConnection] = useState<ProviderConnectionDto | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [visionEndpoint, setVisionEndpoint] = useState('');
  const [visionModelId, setVisionModelId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const next = await loadProviderConnection(DEEPSEEK_API_CONNECTION_ID);
      setConnection(next);
      setVisionEndpoint(next.settings.visionEndpoint ?? '');
      setVisionModelId(next.settings.visionModelId ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    if (active) void load();
  }, [active]);

  async function run(action: 'save' | 'test' | 'clear') {
    setBusy(action);
    setError('');
    try {
      const next =
        action === 'save'
          ? await window.desktopApi.providerConnectionSave({
              connectionId: DEEPSEEK_API_CONNECTION_ID,
              apiKey,
              settings: { visionEndpoint, visionModelId },
            })
          : action === 'test'
            ? await window.desktopApi.providerConnectionVerify(DEEPSEEK_API_CONNECTION_ID)
            : await window.desktopApi.providerConnectionRemove(DEEPSEEK_API_CONNECTION_ID);
      setConnection(next);
      setApiKey('');
      setVisionEndpoint(next.settings.visionEndpoint ?? '');
      setVisionModelId(next.settings.visionModelId ?? '');
      await onConnectionChanged();
      notify(action === 'clear' ? l.notices.cleared : action === 'test' ? l.notices.tested : l.notices.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  const status = connection?.connectionState ?? 'NOT_CONFIGURED';
  const visionSettingsComplete = Boolean(visionEndpoint.trim()) === Boolean(visionModelId.trim());
  const canSave = Boolean(apiKey.trim() || connection?.configured) && visionSettingsComplete;
  const lastVerified = connection?.lastVerifiedAt
    ? new Date(connection.lastVerifiedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
    : l.neverVerified;

  return (
    <section data-deepseek-api-configuration className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4" />
        <h3 className="text-sm font-semibold">{l.title}</h3>
        <Badge className="ml-auto" variant={status === 'READY' ? 'default' : 'outline'}>
          {l.statuses[status]}
        </Badge>
      </header>
      <div className="grid gap-4 p-4">
        <Field>
          <FieldLabel>{l.apiKey}</FieldLabel>
          <FieldControl>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              value={apiKey}
              placeholder={connection?.credentialHint ?? l.keyPlaceholder}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </FieldControl>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>{l.visionEndpoint}</FieldLabel>
            <FieldControl>
              <Input
                type="url"
                autoComplete="off"
                spellCheck={false}
                disabled={Boolean(busy)}
                value={visionEndpoint}
                placeholder={l.visionEndpointPlaceholder}
                onChange={(event) => setVisionEndpoint(event.target.value)}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{l.visionModel}</FieldLabel>
            <FieldControl>
              <Input
                autoComplete="off"
                spellCheck={false}
                disabled={Boolean(busy)}
                value={visionModelId}
                placeholder={l.visionModelPlaceholder}
                onChange={(event) => setVisionModelId(event.target.value)}
              />
            </FieldControl>
          </Field>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-surface-sunken/55 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">{l.model}</dt>
          <dd className="text-right font-mono">{connection?.modelId ?? '—'}</dd>
          <dt className="text-muted-foreground">{l.secureStorage}</dt>
          <dd className="flex justify-end">
            <ShieldCheckIcon className="size-3.5 text-success" />
          </dd>
          <dt className="text-muted-foreground">{l.savedKey}</dt>
          <dd className="text-right font-mono">{connection?.credentialHint ?? '—'}</dd>
          <dt className="text-muted-foreground">{l.lastVerified}</dt>
          <dd className="text-right">{lastVerified}</dd>
        </dl>

        {connection?.message && status !== 'NOT_CONFIGURED' && (
          <p
            role="status"
            className={status === 'ERROR' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
          >
            {connection.message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {connection?.configured && (
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void run('clear')}>
              {busy === 'clear' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              {l.actions.clear}
            </Button>
          )}
          {connection?.configured && (
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void run('test')}>
              {busy === 'test' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <PlugZapIcon className="size-4" />
              )}
              {l.actions.test}
            </Button>
          )}
          <Button type="button" disabled={Boolean(busy) || !canSave} onClick={() => void run('save')}>
            {busy === 'save' ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
            {l.actions.saveAndTest}
          </Button>
        </div>
      </div>
    </section>
  );
}

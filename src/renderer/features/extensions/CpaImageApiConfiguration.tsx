import { KeyRoundIcon, LoaderCircleIcon, PlugZapIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderConnectionDto } from '@/shared/contracts';
import { CPA_IMAGE_CONNECTION_ID } from '@/shared/extension-ids';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { loadProviderConnection } from '@/renderer/features/extensions/providerConnectionClient';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  active: boolean;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

export function CpaImageApiConfiguration({ active, notify, onConnectionChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.cpaImageApi;
  const [connection, setConnection] = useState<ProviderConnectionDto | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8317/v1');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    void loadProviderConnection(CPA_IMAGE_CONNECTION_ID)
      .then((next) => {
        setConnection(next);
        setBaseUrl(next.settings.baseUrl ?? 'http://127.0.0.1:8317/v1');
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [active]);

  async function run(action: 'save' | 'verify' | 'remove') {
    setBusy(action);
    setError('');
    try {
      const next =
        action === 'save'
          ? await window.desktopApi.providerConnectionSave({
              connectionId: CPA_IMAGE_CONNECTION_ID,
              apiKey,
              settings: { baseUrl },
            })
          : action === 'verify'
            ? await window.desktopApi.providerConnectionVerify(CPA_IMAGE_CONNECTION_ID)
            : await window.desktopApi.providerConnectionRemove(CPA_IMAGE_CONNECTION_ID);
      setConnection(next);
      setBaseUrl(next.settings.baseUrl ?? 'http://127.0.0.1:8317/v1');
      setApiKey('');
      await onConnectionChanged();
      notify(l.notices[action]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(l.errors[message as keyof typeof l.errors] ?? message);
    } finally {
      setBusy('');
    }
  }

  const status = connection?.connectionState ?? 'NOT_CONFIGURED';
  const message = connection?.message;
  const statusMessage = message ? (l.messages[message as keyof typeof l.messages] ?? message) : null;
  const lastVerified = connection?.lastVerifiedAt
    ? new Date(connection.lastVerifiedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
    : l.neverVerified;

  return (
    <section data-cpa-image-api-configuration className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4" />
        <h3 className="text-sm font-semibold">{l.title}</h3>
        <Badge className="ml-auto" variant={status === 'READY' ? 'default' : 'outline'}>
          {l.statuses[status]}
        </Badge>
      </header>
      <div className="grid gap-4 p-4">
        <Field>
          <FieldLabel>{l.baseUrl}</FieldLabel>
          <FieldControl>
            <Input
              value={baseUrl}
              disabled={Boolean(busy)}
              spellCheck={false}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </FieldControl>
        </Field>
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">{l.savedKey}</dt>
          <dd className="text-right font-mono">{connection?.credentialHint ?? '—'}</dd>
          <dt className="text-muted-foreground">{l.lastVerified}</dt>
          <dd className="text-right">{lastVerified}</dd>
        </dl>
        {statusMessage && (
          <p role="status" className="text-xs text-muted-foreground">
            {statusMessage}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {connection?.configured && (
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void run('remove')}>
              {busy === 'remove' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              {l.actions.remove}
            </Button>
          )}
          {connection?.configured && (
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void run('verify')}>
              {busy === 'verify' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <PlugZapIcon className="size-4" />
              )}
              {l.actions.verify}
            </Button>
          )}
          <Button
            type="button"
            disabled={Boolean(busy) || !(apiKey.trim() || connection?.configured)}
            onClick={() => void run('save')}
          >
            {busy === 'save' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
            {l.actions.save}
          </Button>
        </div>
      </div>
    </section>
  );
}

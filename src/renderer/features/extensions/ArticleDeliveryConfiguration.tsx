import { KeyRoundIcon, LoaderCircleIcon, PlugZapIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ArticleDeliveryConnectionDto, ExtensionDto } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  articleDeliveryConnectionMessage,
  articleDeliveryRequestErrorMessage,
  type ArticleDeliveryMessages,
} from '@/renderer/features/article-delivery/presentation';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

function connectionNotice(
  action: 'save' | 'test' | 'clear',
  connection: ArticleDeliveryConnectionDto,
  displayName: string,
  copy: ArticleDeliveryMessages,
) {
  if (action === 'clear') return copy.connection.cleared.replace('{name}', displayName);
  if (connection.state === 'READY') return copy.connection.connected.replace('{name}', displayName);
  return articleDeliveryConnectionMessage(connection, copy);
}

function ArticleDeliveryConnectionMessages({
  connection,
  error,
}: {
  connection: ArticleDeliveryConnectionDto | null;
  error: string;
}) {
  const copy = useI18n().messages.articleDelivery;
  return (
    <>
      {connection?.state === 'ERROR' && (
        <p role="status" className="text-xs text-destructive">
          {articleDeliveryConnectionMessage(connection, copy)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function ArticleDeliveryConnectionActions({
  busy,
  canSave,
  configured,
  onRun,
}: {
  busy: string;
  canSave: boolean;
  configured: boolean;
  onRun(action: 'save' | 'test' | 'clear'): void;
}) {
  const copy = useI18n().messages.articleDelivery.connection;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {configured && (
        <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => onRun('clear')}>
          {busy === 'clear' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
          {copy.clear}
        </Button>
      )}
      {configured && (
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => onRun('test')}>
          {busy === 'test' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlugZapIcon className="size-4" />}
          {copy.test}
        </Button>
      )}
      <Button type="button" disabled={Boolean(busy) || !canSave} onClick={() => onRun('save')}>
        {busy === 'save' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
        {copy.save}
      </Button>
    </div>
  );
}

export function ArticleDeliveryConfiguration({ active, extension, notify, onConnectionChanged }: Props) {
  const i18n = useI18n();
  const copy = i18n.messages.articleDelivery;
  const configuration = extension.manifest.configuration;
  const channelId = extension.manifest.contributes.deliveryChannels?.[0] ?? '';
  const target = useMemo(() => ({ extensionId: extension.manifest.id, channelId }), [channelId, extension.manifest.id]);
  const localized = localizeExtensionManifest(extension.manifest, i18n.locale);
  const defaultEndpointId = configuration?.kind === 'ARTICLE_DELIVERY' ? configuration.defaultEndpointId : '';
  const [connection, setConnection] = useState<ArticleDeliveryConnectionDto | null>(null);
  const [endpointId, setEndpointId] = useState(defaultEndpointId);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await window.desktopApi.articleDeliveryConnectionGet(target);
      setConnection(next);
      setEndpointId(next.endpointId ?? defaultEndpointId);
    } catch (reason) {
      setError(articleDeliveryRequestErrorMessage(reason, copy, copy.connection.loadFailed));
    }
  }, [copy, defaultEndpointId, target]);

  useEffect(() => {
    if (active && channelId) void load();
  }, [active, channelId, load]);

  async function run(action: 'save' | 'test' | 'clear') {
    setBusy(action);
    setError('');
    try {
      const next =
        action === 'save'
          ? await window.desktopApi.articleDeliveryConnectionSave({ ...target, endpointId, token })
          : action === 'test'
            ? await window.desktopApi.articleDeliveryConnectionTest(target)
            : await window.desktopApi.articleDeliveryConnectionClear(target);
      setConnection(next);
      setToken('');
      setEndpointId(next.endpointId ?? defaultEndpointId);
      await onConnectionChanged();
      notify(connectionNotice(action, next, localized.displayName, copy));
    } catch (reason) {
      setError(articleDeliveryRequestErrorMessage(reason, copy, copy.connection.saveFailed));
    } finally {
      setBusy('');
    }
  }

  if (configuration?.kind !== 'ARTICLE_DELIVERY' || !channelId) return null;
  const state = connection?.state ?? 'NOT_CONFIGURED';
  const canSave = Boolean(endpointId && (token.trim() || connection?.configured));
  return (
    <section data-article-delivery-configuration={extension.manifest.id} className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4" />
        <h3 className="text-sm font-semibold">{localized.displayName}</h3>
        <Badge className="ml-auto" variant={state === 'READY' ? 'default' : 'outline'}>
          {copy.connection.states[state]}
        </Badge>
      </header>
      <div className="grid gap-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>{copy.connection.url}</FieldLabel>
            <FieldControl>
              <Select value={endpointId} disabled={Boolean(busy)} onValueChange={setEndpointId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {configuration.endpoints.map((endpoint) => (
                    <SelectItem key={endpoint.id} value={endpoint.id}>
                      {endpoint.siteUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{copy.connection.token}</FieldLabel>
            <FieldControl>
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                disabled={Boolean(busy)}
                value={token}
                placeholder={connection?.tokenHint ?? copy.connection.token}
                onChange={(event) => setToken(event.target.value)}
              />
            </FieldControl>
          </Field>
        </div>
        <ArticleDeliveryConnectionMessages connection={connection} error={error} />
        <ArticleDeliveryConnectionActions
          busy={busy}
          canSave={canSave}
          configured={Boolean(connection?.configured)}
          onRun={(action) => void run(action)}
        />
      </div>
    </section>
  );
}

import { KeyRoundIcon, LoaderCircleIcon, PlugZapIcon, SaveIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OpenAiImageModeration, ProviderConnectionDto } from '@/shared/contracts';
import { OPENAI_IMAGE_CONNECTION_ID } from '@/shared/extension-ids';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { loadProviderConnection } from '@/renderer/features/extensions/providerConnectionClient';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  active: boolean;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

export function OpenAiImageApiConfiguration({ active, notify, onConnectionChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.openAiImageApi;
  const [connection, setConnection] = useState<ProviderConnectionDto | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [moderation, setModeration] = useState<OpenAiImageModeration>('auto');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const next = await loadProviderConnection(OPENAI_IMAGE_CONNECTION_ID);
      setConnection(next);
      setOrganizationId(next.settings.organizationId ?? '');
      setProjectId(next.settings.projectId ?? '');
      setModeration(next.settings.moderation === 'low' ? 'low' : 'auto');
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
              connectionId: OPENAI_IMAGE_CONNECTION_ID,
              apiKey,
              settings: { organizationId, projectId, moderation },
            })
          : action === 'test'
            ? await window.desktopApi.providerConnectionVerify(OPENAI_IMAGE_CONNECTION_ID)
            : await window.desktopApi.providerConnectionRemove(OPENAI_IMAGE_CONNECTION_ID);
      setConnection(next);
      setApiKey('');
      setOrganizationId(next.settings.organizationId ?? '');
      setProjectId(next.settings.projectId ?? '');
      setModeration(next.settings.moderation === 'low' ? 'low' : 'auto');
      await onConnectionChanged();
      notify(action === 'clear' ? l.notices.cleared : action === 'test' ? l.notices.tested : l.notices.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  const status = connection?.connectionState ?? 'NOT_CONFIGURED';
  const canSave = Boolean(apiKey.trim() || connection?.configured);
  const lastVerified = connection?.lastVerifiedAt
    ? new Date(connection.lastVerifiedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
    : l.neverVerified;

  return (
    <section data-openai-image-api-configuration className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4" />
        <h3 className="text-sm font-semibold">{l.title}</h3>
        <Badge className="ml-auto" variant={status === 'READY' ? 'default' : 'outline'}>
          {l.statuses[status]}
        </Badge>
      </header>
      <div className="grid gap-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field className="md:col-span-2">
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
          <Field>
            <FieldLabel>
              {l.organizationId} · {l.optional}
            </FieldLabel>
            <FieldControl>
              <Input
                value={organizationId}
                disabled={Boolean(busy)}
                spellCheck={false}
                placeholder={l.organizationPlaceholder}
                onChange={(event) => setOrganizationId(event.target.value)}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>
              {l.projectId} · {l.optional}
            </FieldLabel>
            <FieldControl>
              <Input
                value={projectId}
                disabled={Boolean(busy)}
                spellCheck={false}
                placeholder={l.projectPlaceholder}
                onChange={(event) => setProjectId(event.target.value)}
              />
            </FieldControl>
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel>{l.moderation}</FieldLabel>
            <FieldControl>
              <Select
                value={moderation}
                disabled={Boolean(busy)}
                onValueChange={(value) => setModeration(value as OpenAiImageModeration)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{l.moderationOptions.auto}</SelectItem>
                  <SelectItem value="low">{l.moderationOptions.low}</SelectItem>
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-surface-sunken/55 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">{l.secureStorage}</dt>
          <dd className="flex justify-end">
            <ShieldCheckIcon className="size-3.5 text-success" />
          </dd>
          <dt className="text-muted-foreground">{l.savedKey}</dt>
          <dd className="text-right font-mono">{connection?.credentialHint ?? '—'}</dd>
          <dt className="text-muted-foreground">{l.lastVerified}</dt>
          <dd className="text-right">{lastVerified}</dd>
        </dl>

        {connection?.message && (
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
            {busy === 'save' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
            {l.actions.save}
          </Button>
        </div>
      </div>
    </section>
  );
}

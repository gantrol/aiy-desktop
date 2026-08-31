import { KeyRoundIcon, LoaderCircleIcon, PlugZapIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExtensionManifestDto, ProviderConnectionDto } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { externalImageConnectionId, type ExternalImageApiExtensionId } from '@/shared/extension-ids';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { loadProviderConnection } from '@/renderer/features/extensions/providerConnectionClient';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  active: boolean;
  manifest: ExtensionManifestDto;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

export function ExternalImageApiConfiguration({ active, manifest, notify, onConnectionChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.externalImageApi;
  const extensionId = manifest.id as ExternalImageApiExtensionId;
  const connectionId = externalImageConnectionId(extensionId);
  const configuration = manifest.configuration?.kind === 'IMAGE_API' ? manifest.configuration : null;
  const pluginCopy = localizeExtensionManifest(manifest, locale).configuration;
  const [connection, setConnection] = useState<ProviderConnectionDto | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const endpointPresetId = settings.endpointPresetId || configuration?.defaultEndpointPresetId || '';
  const selectedPreset = configuration?.endpointPresets.find((preset) => preset.id === endpointPresetId);
  const customEndpointSelected = endpointPresetId === 'custom';
  const supportsConnectionCheck = configuration?.connectionCheckPresetIds.includes(endpointPresetId) === true;

  async function load() {
    setError('');
    try {
      const next = await loadProviderConnection(connectionId);
      setConnection(next);
      setSettings(next.settings);
      setApiKey('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    if (active) void load();
  }, [active, connectionId]);

  async function run(action: 'save' | 'test' | 'clear') {
    setBusy(action);
    setError('');
    try {
      const next =
        action === 'save'
          ? await window.desktopApi.providerConnectionSave({ connectionId, apiKey, settings })
          : action === 'test'
            ? await window.desktopApi.providerConnectionVerify(connectionId)
            : await window.desktopApi.providerConnectionRemove(connectionId);
      setConnection(next);
      setApiKey('');
      setSettings(next.settings);
      await onConnectionChanged();
      notify(action === 'clear' ? l.notices.cleared : action === 'test' ? l.notices.tested : l.notices.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  const status = connection?.connectionState ?? 'NOT_CONFIGURED';
  const activeSettingFields =
    configuration?.settingFields.filter((field) => field.endpointPresetIds.includes(endpointPresetId)) ?? [];
  const canSave =
    Boolean(apiKey.trim() || connection?.configured) &&
    activeSettingFields.every((field) => !field.required || Boolean(settings[field.key]?.trim())) &&
    (!customEndpointSelected || Boolean(settings.customEndpoint?.trim() && settings.modelId?.trim()));
  const lastVerified = connection?.lastVerifiedAt
    ? new Date(connection.lastVerifiedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
    : supportsConnectionCheck
      ? l.neverChecked
      : l.verifyOnFirstUse;

  if (!configuration || !pluginCopy) return null;

  return (
    <section data-external-image-api-configuration={extensionId} className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4" />
        <h3 className="text-sm font-semibold">{pluginCopy.title}</h3>
        <Badge className="ml-auto" variant={status === 'READY' ? 'default' : 'outline'}>
          {l.statuses[status]}
        </Badge>
      </header>
      <div className="grid gap-4 p-4">
        <Field>
          <FieldLabel>{pluginCopy.apiKeyLabel}</FieldLabel>
          <FieldControl>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              value={apiKey}
              placeholder={connection?.credentialHint ?? pluginCopy.apiKeyPlaceholder}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </FieldControl>
        </Field>

        <Field>
          <FieldLabel>{pluginCopy.endpointLabel}</FieldLabel>
          <Select
            value={endpointPresetId}
            disabled={Boolean(busy)}
            onValueChange={(nextEndpointPresetId) => {
              const preset = configuration.endpointPresets.find((candidate) => candidate.id === nextEndpointPresetId);
              setSettings((current) => ({
                ...current,
                endpointPresetId: nextEndpointPresetId,
                modelId: preset?.modelId || current.modelId || selectedPreset?.modelId || '',
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {configuration.endpointPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {pluginCopy.endpointOptions[preset.id] ?? preset.id}
                </SelectItem>
              ))}
              {configuration.customEndpointAllowed && (
                <SelectItem value="custom">{pluginCopy.endpointOptions.custom ?? l.otherEndpoint}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        {activeSettingFields.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {activeSettingFields.map((field) => {
              const fieldCopy = pluginCopy.fields[field.key];
              return (
                <Field key={field.key}>
                  <FieldLabel>{fieldCopy?.label ?? field.key}</FieldLabel>
                  <FieldControl>
                    <Input
                      value={settings[field.key] ?? ''}
                      disabled={Boolean(busy)}
                      spellCheck={false}
                      placeholder={fieldCopy?.placeholder ?? ''}
                      onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  </FieldControl>
                </Field>
              );
            })}
          </div>
        )}

        {customEndpointSelected && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{pluginCopy.customEndpointLabel}</FieldLabel>
              <FieldControl>
                <Input
                  type="url"
                  value={settings.customEndpoint ?? ''}
                  disabled={Boolean(busy)}
                  spellCheck={false}
                  placeholder={pluginCopy.customEndpointPlaceholder}
                  onChange={(event) => setSettings((current) => ({ ...current, customEndpoint: event.target.value }))}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{pluginCopy.modelIdLabel}</FieldLabel>
              <FieldControl>
                <Input
                  value={settings.modelId ?? ''}
                  disabled={Boolean(busy)}
                  spellCheck={false}
                  placeholder={pluginCopy.modelIdPlaceholder}
                  onChange={(event) => setSettings((current) => ({ ...current, modelId: event.target.value }))}
                />
              </FieldControl>
            </Field>
          </div>
        )}

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
          {connection?.configured && supportsConnectionCheck && (
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
            {supportsConnectionCheck ? l.actions.saveAndCheck : l.actions.save}
          </Button>
        </div>
      </div>
    </section>
  );
}

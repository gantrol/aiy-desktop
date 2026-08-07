import { useEffect, useMemo, useState } from 'react';
import type { ExtensionContributionPoint, ExtensionDto, Locale } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { EXTENSION_HOST_ENGINE_KEY } from '@/shared/product';
import {
  BlocksIcon,
  LanguagesIcon,
  PackagePlusIcon,
  PowerIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  OPENAI_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { OpenAiImageApiConfiguration } from '@/renderer/features/extensions/OpenAiImageApiConfiguration';
import { DeepSeekApiConfiguration } from '@/renderer/features/extensions/DeepSeekApiConfiguration';
import { ExternalImageApiConfiguration } from '@/renderer/features/extensions/ExternalImageApiConfiguration';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import { DeleteEntityDialog } from '@/renderer/components/app/DeleteEntityDialog';
import { ExtensionPluginList } from '@/renderer/features/extensions/ExtensionPluginList';
import { firstGroupedExtensionId } from '@/renderer/features/extensions/extensionPluginGroups';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';

interface Props {
  active: boolean;
  requestedId: string | null;
  onSelectedIdChange(id: string, mode?: NavigationMode): void;
  onExtensionsChange(): void;
  codexImagesNavigation: CodexImagesNavigationState;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

const contributionOrder: ExtensionContributionPoint[] = [
  'modelProviders',
  'tools',
  'workflows',
  'commands',
  'searchProviders',
  'filters',
  'fields',
  'themes',
];
const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);

function localizedShowInSidebarLabel(locale: Locale, translated?: string) {
  if (translated) return translated;
  return locale === 'zh' ? '在侧边栏显示 Codex 图片' : 'Show Codex images in sidebar';
}

export function ExtensionPluginScreen({
  active,
  requestedId,
  onSelectedIdChange,
  onExtensionsChange,
  codexImagesNavigation,
  notify,
  onOpenCreation,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions;
  const [extensions, setExtensions] = useState<ExtensionDto[]>([]);
  const [selectedId, setSelectedId] = useState(requestedId ?? '');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDto | null>(null);

  async function load(refreshConnection = false) {
    setLoading(true);
    setError('');
    try {
      if (refreshConnection) await window.desktopApi.codexHealth();
      const next = await window.desktopApi.extensionsList();
      setExtensions(next);
      publishLanguagePluginState(next);
      const preferredId =
        requestedId && next.some((item) => item.manifest.id === requestedId)
          ? requestedId
          : selectedId && next.some((item) => item.manifest.id === selectedId)
            ? selectedId
            : firstGroupedExtensionId(next);
      setSelectedId(preferredId);
      if (preferredId && preferredId !== requestedId) onSelectedIdChange(preferredId, 'replace');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) void load();
  }, [active]);

  useEffect(() => {
    if (requestedId !== null) setSelectedId(requestedId);
  }, [requestedId]);

  const selected = useMemo(
    () => extensions.find((extension) => extension.manifest.id === selectedId) ?? null,
    [extensions, selectedId],
  );
  const showInSidebarLabel = localizedShowInSidebarLabel(locale, l.codexImageDiscovery.actions.showInSidebar);

  async function setEnabled(extension: ExtensionDto, enabled: boolean) {
    setBusyKey(`enabled:${extension.manifest.id}`);
    setError('');
    try {
      const next = await window.desktopApi.extensionSetEnabled({
        extensionId: extension.manifest.id,
        enabled,
      });
      setExtensions(next);
      onExtensionsChange();
      publishLanguagePluginState(next);
      notify(enabled ? l.notices.enabled : l.notices.disabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey('');
    }
  }

  async function setPermission(extension: ExtensionDto, permission: string, granted: boolean) {
    const key = `permission:${extension.manifest.id}:${permission}`;
    setBusyKey(key);
    setError('');
    try {
      const next = await window.desktopApi.extensionSetPermission({
        extensionId: extension.manifest.id,
        permission,
        granted,
      });
      setExtensions(next);
      onExtensionsChange();
      notify(granted ? l.notices.permissionGranted : l.notices.permissionRevoked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey('');
    }
  }

  async function installLocal() {
    setBusyKey('install');
    setError('');
    try {
      const result = await window.desktopApi.extensionInstallLocal();
      setExtensions(result.extensions);
      onExtensionsChange();
      publishLanguagePluginState(result.extensions);
      if (result.extensionId) {
        setSelectedId(result.extensionId);
        onSelectedIdChange(result.extensionId);
        notify(l.notices.installed);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey('');
    }
  }

  async function uninstallLocal() {
    if (!uninstallTarget) return;
    setBusyKey(`uninstall:${uninstallTarget.manifest.id}`);
    setError('');
    try {
      const next = await window.desktopApi.extensionUninstallLocal(uninstallTarget.manifest.id);
      setExtensions(next);
      onExtensionsChange();
      publishLanguagePluginState(next);
      const preferredId = next.some((extension) => extension.manifest.id === uninstallTarget.manifest.id)
        ? uninstallTarget.manifest.id
        : firstGroupedExtensionId(next);
      setSelectedId(preferredId);
      onSelectedIdChange(preferredId, 'replace');
      setUninstallTarget(null);
      notify(l.notices.uninstalled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey('');
    }
  }

  const enabledLanguageCount = extensions.filter(
    (extension) => extension.manifest.kind === 'LANGUAGE' && extension.enabled,
  ).length;
  const selectedIsLastLanguage =
    selected?.manifest.kind === 'LANGUAGE' && selected.enabled && enabledLanguageCount === 1;

  return (
    <div
      data-extension-plugin-screen
      className="grid size-full min-h-0 grid-cols-[minmax(260px,360px)_minmax(0,1fr)] bg-background"
    >
      <div className="flex min-h-0 flex-col border-r">
        <div className="border-b p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={Boolean(busyKey)}
            onClick={() => void installLocal()}
          >
            <PackagePlusIcon className="size-4" />
            {l.actions.installLocal}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ExtensionPluginList
            extensions={extensions}
            selectedId={selectedId}
            onSelect={(extensionId) => {
              setSelectedId(extensionId);
              onSelectedIdChange(extensionId);
            }}
          />
        </ScrollArea>
      </div>

      <ScrollArea className="min-h-0">
        {selected && (
          <article className="mx-auto grid w-full max-w-4xl gap-6 p-6">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted">
                {selected.manifest.kind === 'LANGUAGE' ? (
                  <LanguagesIcon className="size-5" />
                ) : (
                  <BlocksIcon className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">
                    {localizeExtensionManifest(selected.manifest, locale).displayName}
                  </h2>
                  <Badge variant="outline">{selected.manifest.version}</Badge>
                  <Badge variant="outline">{l.kinds[selected.manifest.kind]}</Badge>
                  <Badge variant={selected.connectionState === 'READY' ? 'default' : 'secondary'}>
                    {l.connectionStates[selected.connectionState]}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {localizeExtensionManifest(selected.manifest, locale).description}
                </p>
                {!(
                  selected.manifest.id === DEEPSEEK_API_EXTENSION_ID &&
                  selected.connectionState === 'NEEDS_CONFIGURATION'
                ) && <p className="mt-1 text-xs text-muted-foreground">{selected.connectionMessage}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={l.actions.refresh}
                  disabled={loading || Boolean(busyKey)}
                  onClick={() => void load(true)}
                >
                  <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
                </Button>
                <Button
                  type="button"
                  variant={selected.enabled ? 'outline' : 'default'}
                  disabled={Boolean(busyKey) || selectedIsLastLanguage}
                  title={selectedIsLastLanguage ? l.notices.languageRequired : undefined}
                  onClick={() => void setEnabled(selected, !selected.enabled)}
                >
                  <PowerIcon className="size-4" />
                  {selected.enabled ? l.actions.disable : l.actions.enable}
                </Button>
                {selected.source === 'LOCAL' && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={Boolean(busyKey)}
                    onClick={() => {
                      setError('');
                      setUninstallTarget(selected);
                    }}
                  >
                    <Trash2Icon className="size-4" />
                    {l.actions.uninstall}
                  </Button>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
              <div className="bg-background p-3">
                <dt className="text-xs text-muted-foreground">{l.fields.manifest}</dt>
                <dd className="mt-1 font-medium">{selected.manifest.manifestVersion}</dd>
              </div>
              <div className="bg-background p-3">
                <dt className="text-xs text-muted-foreground">{l.fields.engine}</dt>
                <dd className="mt-1 font-medium">{selected.manifest.engines[EXTENSION_HOST_ENGINE_KEY]}</dd>
              </div>
              <div className="bg-background p-3">
                <dt className="text-xs text-muted-foreground">{l.fields.source}</dt>
                <dd className="mt-1 font-medium">{l.source[selected.source]}</dd>
              </div>
              <div className="bg-background p-3">
                <dt className="text-xs text-muted-foreground">{l.fields.compatibility}</dt>
                <dd className="mt-1 font-medium">{selected.compatible ? l.compatible : l.incompatible}</dd>
              </div>
              {selected.manifest.runtime && (
                <div className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.fields.runtime}</dt>
                  <dd className="mt-1 font-medium">{selected.manifest.runtime.id}</dd>
                </div>
              )}
            </dl>

            {selected.manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID && (
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm font-medium">
                <span>{showInSidebarLabel}</span>
                <Checkbox
                  checked={codexImagesNavigation.enabled}
                  disabled={!selected.enabled || Boolean(busyKey)}
                  onCheckedChange={(checked) => codexImagesNavigation.setEnabled(checked === true)}
                />
              </label>
            )}

            {selected.manifest.id === OPENAI_IMAGE_API_EXTENSION_ID && (
              <OpenAiImageApiConfiguration active={active} notify={notify} onConnectionChanged={() => load(false)} />
            )}
            {selected.manifest.id === DEEPSEEK_API_EXTENSION_ID && (
              <DeepSeekApiConfiguration active={active} notify={notify} onConnectionChanged={() => load(false)} />
            )}
            {externalImageApiExtensionIds.has(selected.manifest.id) && (
              <ExternalImageApiConfiguration
                active={active}
                manifest={selected.manifest}
                notify={notify}
                onConnectionChanged={() => load(false)}
              />
            )}
            {selected.manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID && (
              <CodexImageDiscoveryConfiguration
                active={active}
                extension={selected}
                notify={notify}
                onOpenCreation={onOpenCreation}
              />
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-lg border">
                <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
                  <BlocksIcon className="size-4" />
                  {l.sections.contributions}
                </h3>
                <div className="divide-y">
                  {contributionOrder.flatMap((point) =>
                    (selected.manifest.contributes[point] ?? []).map((contribution) => (
                      <div key={`${point}:${contribution}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{contribution}</span>
                        <Badge variant="outline">{l.contributionPoints[point]}</Badge>
                      </div>
                    )),
                  )}
                </div>
              </section>

              <section className="rounded-lg border">
                <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
                  <ShieldCheckIcon className="size-4" />
                  {l.sections.permissions}
                </h3>
                <div className="divide-y">
                  {selected.permissions.map((permission) => {
                    const key = `permission:${selected.manifest.id}:${permission.key}`;
                    return (
                      <label
                        key={permission.key}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm"
                      >
                        <Checkbox
                          checked={permission.granted}
                          disabled={Boolean(busyKey)}
                          onCheckedChange={(checked) => void setPermission(selected, permission.key, checked === true)}
                        />
                        <span className="min-w-0 flex-1 break-all font-mono text-xs">{permission.key}</span>
                        <Badge variant={permission.required ? 'secondary' : 'outline'}>
                          {permission.required ? l.required : l.optional}
                        </Badge>
                        {busyKey === key && <RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground" />}
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
          </article>
        )}
        {!selected && error && (
          <div
            role="alert"
            className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
      </ScrollArea>
      <DeleteEntityDialog
        open={Boolean(uninstallTarget)}
        title={l.uninstall.title}
        description={l.uninstall.description}
        cancelLabel={messages.common.cancel}
        confirmLabel={l.actions.uninstall}
        busy={busyKey.startsWith('uninstall:')}
        error={uninstallTarget ? error : undefined}
        onOpenChange={(open) => {
          if (!open && !busyKey) setUninstallTarget(null);
        }}
        onConfirm={() => void uninstallLocal()}
      />
    </div>
  );
}

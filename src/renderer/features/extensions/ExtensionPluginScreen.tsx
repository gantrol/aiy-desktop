import { useEffect, useMemo, useRef, useState } from 'react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { PackagePlusIcon, PowerIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import { DeleteEntityDialog } from '@/renderer/components/app/DeleteEntityDialog';
import { ExtensionPluginHeader } from '@/renderer/features/extensions/ExtensionPluginHeader';
import { ExtensionPluginList } from '@/renderer/features/extensions/ExtensionPluginList';
import { firstGroupedExtensionId } from '@/renderer/features/extensions/extensionPluginGroups';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import { ExtensionFeatureErrorBoundary } from '@/renderer/features/extensions/ExtensionFeatureErrorBoundary';
import {
  ExtensionPluginFeaturePage,
  hasExtensionPluginFeature,
} from '@/renderer/features/extensions/ExtensionPluginFeaturePage';
import { ExtensionPluginSettingsPage } from '@/renderer/features/extensions/ExtensionPluginSettingsPage';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';

interface Props {
  active: boolean;
  data: BootstrapDto;
  dataRevision: number;
  requestedId: string | null;
  onSelectedIdChange(id: string, mode?: NavigationMode): void;
  onExtensionsChange(): void;
  codexImagesNavigation: CodexImagesNavigationState;
  transitionShowcaseNavigation: TransitionShowcaseNavigationState;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

function hasPendingExtensionMutation(busyKey: string, pendingPermissionKeys: ReadonlySet<string>) {
  return Boolean(busyKey) || pendingPermissionKeys.size > 0;
}

function initialSelectedExtensionId(requestedId: string | null, extensions: readonly ExtensionDto[]) {
  if (requestedId && extensions.some((extension) => extension.manifest.id === requestedId)) {
    return requestedId;
  }
  return firstGroupedExtensionId(extensions);
}

export function ExtensionPluginScreen({
  active,
  data,
  dataRevision,
  requestedId,
  onSelectedIdChange,
  onExtensionsChange,
  codexImagesNavigation,
  transitionShowcaseNavigation,
  notify,
  onOpenCreation,
}: Props) {
  const { messages } = useI18n();
  const l = messages.extensions;
  const [extensions, setExtensions] = useState<ExtensionDto[]>(() => data.extensions ?? []);
  const appliedBootstrapExtensionsRef = useRef(data.extensions);
  const [selectedId, setSelectedId] = useState(() => initialSelectedExtensionId(requestedId, data.extensions ?? []));
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [pendingPermissionKeys, setPendingPermissionKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDto | null>(null);
  const [tabSelection, setTabSelection] = useState<{
    extensionId: string;
    tab: 'feature' | 'settings';
  } | null>(null);

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
    if (appliedBootstrapExtensionsRef.current === data.extensions) return;
    appliedBootstrapExtensionsRef.current = data.extensions;
    const next = data.extensions ?? [];
    setExtensions(next);
    setSelectedId((current) => {
      return next.some((extension) => extension.manifest.id === current) ? current : firstGroupedExtensionId(next);
    });
  }, [data.extensions]);

  useEffect(() => {
    if (requestedId !== null && extensions.some((extension) => extension.manifest.id === requestedId)) {
      setSelectedId(requestedId);
    }
  }, [extensions, requestedId]);

  const selected = useMemo(
    () => extensions.find((extension) => extension.manifest.id === selectedId) ?? null,
    [selectedId, extensions],
  );

  function setPermissionPending(key: string, pending: boolean) {
    setPendingPermissionKeys((current) => {
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }

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
    if (busyKey || pendingPermissionKeys.has(key)) return;
    setPermissionPending(key, true);
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
      setPermissionPending(key, false);
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
      const installed = result.extensionId
        ? result.extensions.find((extension) => extension.manifest.id === result.extensionId)
        : null;
      if (installed) {
        setSelectedId(installed.manifest.id);
        onSelectedIdChange(installed.manifest.id);
      }
      if (result.extensionId) notify(l.notices.installed);
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
  const hasFeature = Boolean(selected && hasExtensionPluginFeature(selected));
  const requestedTab = tabSelection && tabSelection.extensionId === selected?.manifest.id ? tabSelection.tab : null;
  const pluginTab = hasFeature && requestedTab !== 'settings' ? 'feature' : 'settings';
  const controlsBusy = hasPendingExtensionMutation(busyKey, pendingPermissionKeys);

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
            disabled={controlsBusy}
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

      <ScrollArea className="@container/extension-detail min-h-0 min-w-0">
        {selected && (
          <article className="mx-auto grid w-full max-w-6xl gap-5 p-4 @5xl/extension-detail:gap-6 @5xl/extension-detail:p-6">
            <ExtensionPluginHeader
              extension={selected}
              actions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={l.actions.refresh}
                    title={l.actions.refresh}
                    disabled={loading || controlsBusy}
                    onClick={() => void load(true)}
                  >
                    <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
                  </Button>
                  <Button
                    type="button"
                    variant={selected.enabled ? 'outline' : 'default'}
                    disabled={controlsBusy || selectedIsLastLanguage}
                    aria-label={selected.enabled ? l.actions.disable : l.actions.enable}
                    title={
                      selectedIsLastLanguage
                        ? l.notices.languageRequired
                        : selected.enabled
                          ? l.actions.disable
                          : l.actions.enable
                    }
                    onClick={() => void setEnabled(selected, !selected.enabled)}
                  >
                    <PowerIcon className="size-4" />
                    <span className="hidden @lg/extension-detail:inline">
                      {selected.enabled ? l.actions.disable : l.actions.enable}
                    </span>
                  </Button>
                  {selected.source === 'LOCAL' && (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={controlsBusy}
                      aria-label={l.actions.uninstall}
                      title={l.actions.uninstall}
                      onClick={() => {
                        setError('');
                        setUninstallTarget(selected);
                      }}
                    >
                      <Trash2Icon className="size-4" />
                      <span className="hidden @lg/extension-detail:inline">{l.actions.uninstall}</span>
                    </Button>
                  )}
                </>
              }
            />

            <Tabs
              value={pluginTab}
              onValueChange={(tab) =>
                setTabSelection({ extensionId: selected.manifest.id, tab: tab as 'feature' | 'settings' })
              }
              className="gap-4 @xl/extension-detail:gap-6"
            >
              <TabsList>
                {hasFeature && <TabsTrigger value="feature">{l.pluginTabs.feature}</TabsTrigger>}
                <TabsTrigger value="settings">{l.pluginTabs.settings}</TabsTrigger>
              </TabsList>
              {hasFeature && (
                <TabsContent value="feature">
                  <ExtensionFeatureErrorBoundary scope={`${selected.manifest.id}:feature`}>
                    <ExtensionPluginFeaturePage
                      active={active}
                      data={data}
                      dataRevision={dataRevision}
                      extension={selected}
                      extensions={extensions}
                      notify={notify}
                      onOpenCreation={onOpenCreation}
                    />
                  </ExtensionFeatureErrorBoundary>
                </TabsContent>
              )}
              <TabsContent value="settings">
                <ExtensionFeatureErrorBoundary scope={`${selected.manifest.id}:settings`}>
                  <ExtensionPluginSettingsPage
                    active={active}
                    busyKey={busyKey}
                    pendingPermissionKeys={pendingPermissionKeys}
                    extension={selected}
                    codexImagesNavigation={codexImagesNavigation}
                    transitionShowcaseNavigation={transitionShowcaseNavigation}
                    notify={notify}
                    onConnectionChanged={() => load(false)}
                    onPermissionChange={(permission, granted) => setPermission(selected, permission, granted)}
                  />
                </ExtensionFeatureErrorBoundary>
              </TabsContent>
            </Tabs>

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
          if (!open && !controlsBusy) setUninstallTarget(null);
        }}
        onConfirm={() => void uninstallLocal()}
      />
    </div>
  );
}

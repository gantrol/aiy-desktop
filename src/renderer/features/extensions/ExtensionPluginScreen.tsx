import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { ArrowLeftIcon, PackagePlusIcon, PowerIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import { DeleteEntityDialog } from '@/renderer/components/app/DeleteEntityDialog';
import { ExtensionPluginHeader } from '@/renderer/features/extensions/ExtensionPluginHeader';
import { ExtensionPluginList } from '@/renderer/features/extensions/ExtensionPluginList';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import { ExtensionFeatureErrorBoundary } from '@/renderer/features/extensions/ExtensionFeatureErrorBoundary';
import {
  ExtensionPluginFeaturePage,
  hasExtensionPluginFeature,
} from '@/renderer/features/extensions/ExtensionPluginFeaturePage';
import { ExtensionPluginSettingsPage } from '@/renderer/features/extensions/ExtensionPluginSettingsPage';
import { ExtensionPermissionPanel } from '@/renderer/features/extensions/ExtensionPermissionPanel';
import { useExtensionManager } from '@/renderer/features/extensions/useExtensionManager';
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
const emptyExtensions: readonly ExtensionDto[] = [];
type Manager = ReturnType<typeof useExtensionManager>;

function ExtensionActions({
  extension,
  manager,
  lastLanguage,
  onUninstall,
}: {
  extension: ExtensionDto;
  manager: Manager;
  lastLanguage: boolean;
  onUninstall(): void;
}) {
  const { messages } = useI18n();
  const l = messages.extensions;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={messages.extensionManager.refreshState}
        title={messages.extensionManager.refreshState}
        disabled={manager.loading || Boolean(manager.busyKey)}
        onClick={() => void manager.refresh(l.notices.refreshed)}
      >
        <RefreshCwIcon className={cn('size-4', (manager.loading || manager.busyKey === 'reload') && 'animate-spin')} />
      </Button>
      <Button
        type="button"
        variant={extension.enabled ? 'outline' : 'default'}
        disabled={Boolean(manager.busyKey) || lastLanguage}
        title={lastLanguage ? l.notices.languageRequired : undefined}
        onClick={() =>
          void manager.mutate(
            `enabled:${extension.manifest.id}`,
            () =>
              window.desktopApi.extensionSetEnabled({
                extensionId: extension.manifest.id,
                enabled: !extension.enabled,
              }),
            extension.enabled ? l.notices.disabled : l.notices.enabled,
          )
        }
      >
        <PowerIcon className="size-4" />
        {extension.enabled ? l.actions.disable : l.actions.enable}
      </Button>
      {extension.source === 'LOCAL' && (
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(manager.busyKey)}
          onClick={() => void manager.update(extension.manifest.id, l.notices.updated)}
        >
          {l.actions.updateLocal}
        </Button>
      )}
      {extension.source === 'LOCAL' && (
        <Button type="button" variant="outline" disabled={Boolean(manager.busyKey)} onClick={onUninstall}>
          <Trash2Icon className="size-4" />
          {l.actions.uninstall}
        </Button>
      )}
    </>
  );
}

function ExtensionDetail({
  extension,
  manager,
  props,
  actions,
}: {
  extension: ExtensionDto;
  manager: Manager;
  props: Props;
  actions: ReactNode;
}) {
  const { messages } = useI18n();
  const l = messages.extensions;
  const hasFeature = hasExtensionPluginFeature(extension);
  const missing = extension.permissions.some((permission) => permission.required && !permission.granted);
  const [tab, setTab] = useState(missing ? 'permissions' : hasFeature ? 'feature' : 'settings');
  return (
    <article className="mx-auto grid w-full max-w-6xl gap-5 p-4 @5xl/extension-detail:p-6">
      <ExtensionPluginHeader extension={extension} actions={actions} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full flex-wrap">
          {hasFeature && <TabsTrigger value="feature">{l.pluginTabs.feature}</TabsTrigger>}
          <TabsTrigger value="permissions">{messages.extensionManager.permissions}</TabsTrigger>
          <TabsTrigger value="settings">{l.pluginTabs.settings}</TabsTrigger>
        </TabsList>
        {hasFeature && (
          <TabsContent value="feature">
            <ExtensionFeatureErrorBoundary scope={`${extension.manifest.id}:feature`}>
              <ExtensionPluginFeaturePage
                active={props.active}
                data={props.data}
                dataRevision={props.dataRevision}
                extension={extension}
                extensions={manager.extensions}
                notify={props.notify}
                onOpenCreation={props.onOpenCreation}
              />
            </ExtensionFeatureErrorBoundary>
          </TabsContent>
        )}
        <TabsContent value="permissions">
          <ExtensionPermissionPanel
            key={extension.manifest.id}
            extension={extension}
            busy={Boolean(manager.busyKey)}
            onChange={async (permission, granted) => {
              await manager.mutate(
                `permission:${extension.manifest.id}`,
                () =>
                  window.desktopApi.extensionSetPermission({
                    extensionId: extension.manifest.id,
                    permission,
                    granted,
                  }),
                granted ? l.notices.permissionGranted : l.notices.permissionRevoked,
              );
            }}
            onRevoke={(permissions) =>
              manager.mutate(
                `permissions:${extension.manifest.id}`,
                () =>
                  window.desktopApi.extensionRevokePermissions({
                    extensionId: extension.manifest.id,
                    permissions,
                  }),
                messages.extensionManager.changed,
              )
            }
          />
        </TabsContent>
        <TabsContent value="settings">
          <ExtensionFeatureErrorBoundary scope={`${extension.manifest.id}:settings`}>
            <ExtensionPluginSettingsPage
              active={props.active}
              busyKey={manager.busyKey}
              extension={extension}
              codexImagesNavigation={props.codexImagesNavigation}
              transitionShowcaseNavigation={props.transitionShowcaseNavigation}
              notify={props.notify}
              onConnectionChanged={manager.load}
            />
          </ExtensionFeatureErrorBoundary>
        </TabsContent>
      </Tabs>
    </article>
  );
}

/** The parent keys this surface by space: delayed results cannot enter another library. */
export function ExtensionPluginScreen(props: Props) {
  const { messages } = useI18n();
  const l = messages.extensions;
  const manager = useExtensionManager({ ...props, initial: props.data.extensions ?? emptyExtensions });
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDto | null>(null);
  const [mobileDetail, setMobileDetail] = useState(Boolean(props.requestedId));
  const listPane = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const focusNavigation = useRef(Boolean(props.requestedId));
  const requestedDetail = useRef(props.requestedId);
  useEffect(() => {
    if (requestedDetail.current === props.requestedId) return;
    requestedDetail.current = props.requestedId;
    if (props.requestedId) {
      focusNavigation.current = true;
      setMobileDetail(true);
    }
  }, [props.requestedId]);
  const selected = manager.extensions.find((extension) => extension.manifest.id === manager.selectedId) ?? null;
  const lastLanguage =
    selected?.manifest.kind === 'LANGUAGE' &&
    selected.enabled &&
    manager.extensions.filter((extension) => extension.manifest.kind === 'LANGUAGE' && extension.enabled).length === 1;
  const busy = Boolean(manager.busyKey);
  useEffect(() => {
    if (!focusNavigation.current) return;
    focusNavigation.current = false;
    const list = listPane.current;
    if (!list) return;
    const target = mobileDetail
      ? backButton.current
      : (Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-extension-id]')).find(
          (button) => button.dataset.extensionId === manager.selectedId,
        ) ?? list.querySelector<HTMLInputElement>('input[type="search"]'));
    // Container queries decide which pane is shown; do not focus a hidden control
    // or move keyboard users away from the desktop list during a refresh.
    if (target?.getClientRects().length) target.focus({ preventScroll: true });
  }, [mobileDetail, manager.selectedId]);
  return (
    <div data-extension-plugin-screen className="@container/extension-screen flex size-full min-h-0 flex-col">
      {manager.error && !uninstallTarget && (
        <p
          role="alert"
          className="m-3 shrink-0 break-words rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {manager.error}
        </p>
      )}
      <div className="grid min-h-0 w-full flex-1 grid-cols-1 @3xl/extension-screen:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <div
          ref={listPane}
          className={cn(
            'min-h-0 flex-col border-r border-border @3xl/extension-screen:flex',
            mobileDetail && selected ? 'hidden' : 'flex',
          )}
        >
          <div className="border-b border-border p-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() =>
                void manager.install(l.notices.installed).then((installed) => {
                  if (installed) {
                    focusNavigation.current = true;
                    setMobileDetail(true);
                  }
                })
              }
            >
              <PackagePlusIcon className="size-4" />
              {l.actions.installLocal}
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ExtensionPluginList
              extensions={manager.extensions}
              selectedId={manager.selectedId}
              onSelect={(id) => {
                focusNavigation.current = true;
                manager.select(id);
                setMobileDetail(true);
              }}
            />
          </ScrollArea>
        </div>
        <div
          className={cn(
            '@container/extension-detail min-h-0 min-w-0 flex-col @3xl/extension-screen:flex',
            mobileDetail || !selected ? 'flex' : 'hidden',
          )}
        >
          <div className="shrink-0 px-3 pt-2 @3xl/extension-screen:hidden">
            <Button
              ref={backButton}
              type="button"
              variant="ghost"
              onClick={() => {
                focusNavigation.current = true;
                setMobileDetail(false);
              }}
            >
              <ArrowLeftIcon className="size-4" />
              {messages.extensionManager.backToList}
            </Button>
          </div>
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            {selected ? (
              <ExtensionDetail
                key={selected.manifest.id}
                extension={selected}
                manager={manager}
                props={props}
                actions={
                  <ExtensionActions
                    extension={selected}
                    manager={manager}
                    lastLanguage={Boolean(lastLanguage)}
                    onUninstall={() => {
                      manager.clearError();
                      setUninstallTarget(selected);
                    }}
                  />
                }
              />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">{messages.extensionManager.noSelection}</p>
            )}
          </ScrollArea>
        </div>
      </div>
      <DeleteEntityDialog
        open={Boolean(uninstallTarget)}
        title={l.uninstall.title}
        description={l.uninstall.description}
        cancelLabel={messages.common.cancel}
        confirmLabel={l.actions.uninstall}
        busy={busy}
        error={uninstallTarget ? manager.error : undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setUninstallTarget(null);
        }}
        onConfirm={() => {
          if (!uninstallTarget) return;
          void manager
            .mutate(
              `uninstall:${uninstallTarget.manifest.id}`,
              () => window.desktopApi.extensionUninstallLocal(uninstallTarget.manifest.id),
              l.notices.uninstalled,
            )
            .then((ok) => {
              if (ok) setUninstallTarget(null);
            });
        }}
      />
    </div>
  );
}

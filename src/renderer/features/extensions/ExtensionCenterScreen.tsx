import { useEffect, useRef, useState } from 'react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { Badge } from '@/renderer/components/ui/badge';
import {
  navigationLocationKey,
  type ExtensionsLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { PackScreen } from '@/renderer/features/packs/PackScreen';
import { CodexArtifactsScreen } from '@/renderer/features/extensions/CodexArtifactsScreen';
import { ExtensionPluginScreen } from '@/renderer/features/extensions/ExtensionPluginScreen';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';

interface Props {
  activeSurface: 'center' | 'discovery' | null;
  data: BootstrapDto;
  dataRevision: number;
  extensions: readonly ExtensionDto[];
  location: ExtensionsLocation;
  onNavigate(location: ExtensionsLocation, mode?: NavigationMode): void;
  onExtensionsChange(): void;
  codexImagesNavigation: CodexImagesNavigationState;
  transitionShowcaseNavigation: TransitionShowcaseNavigationState;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

export function ExtensionCenterScreen({
  activeSurface,
  data,
  dataRevision,
  extensions,
  location,
  onNavigate,
  onExtensionsChange,
  codexImagesNavigation,
  transitionShowcaseNavigation,
  notify,
  onOpenCreation,
}: Props) {
  const l = useI18n().messages.extensions;
  const active = activeSurface !== null;
  const locationKey = navigationLocationKey(location);
  const appliedLocationKeyRef = useRef(locationKey);
  const [tab, setTab] = useState<'plugins' | 'contentPacks'>(location.tab);

  function commitExtensionsLocation(nextLocation: ExtensionsLocation, mode: NavigationMode = 'push') {
    appliedLocationKeyRef.current = navigationLocationKey(nextLocation);
    onNavigate(nextLocation, mode);
  }

  useEffect(() => {
    if (activeSurface !== 'center' || appliedLocationKeyRef.current === locationKey) return;
    appliedLocationKeyRef.current = locationKey;
    setTab(location.tab);
  }, [activeSurface, locationKey]);

  if (activeSurface === 'discovery') {
    return (
      <CodexArtifactsScreen
        active
        extension={extensions.find((extension) => extension.manifest.id === CODEX_EXTENSION_ID) ?? null}
        notify={notify}
        onOpenCreation={onOpenCreation}
      />
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const nextTab = value as typeof tab;
        setTab(nextTab);
        commitExtensionsLocation({ ...location, tab: nextTab });
      }}
      className="size-full bg-background"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="text-base font-semibold">{l.title}</h1>
        <Badge variant="secondary">{extensions.length}</Badge>
        <TabsList className="ml-4 h-14 border-0">
          <TabsTrigger value="plugins" className="h-14">
            {l.tabs.plugins}
          </TabsTrigger>
          <TabsTrigger value="contentPacks" className="h-14">
            {l.tabs.contentPacks}
          </TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="plugins" className="min-h-0 flex-1">
        <ExtensionPluginScreen
          key={data.spaceId}
          active={active && tab === 'plugins'}
          data={data}
          dataRevision={dataRevision}
          requestedId={location.pluginId}
          onSelectedIdChange={(pluginId, mode) =>
            commitExtensionsLocation({ ...location, tab: 'plugins', pluginId }, mode)
          }
          onExtensionsChange={onExtensionsChange}
          codexImagesNavigation={codexImagesNavigation}
          transitionShowcaseNavigation={transitionShowcaseNavigation}
          notify={notify}
          onOpenCreation={onOpenCreation}
        />
      </TabsContent>
      <TabsContent value="contentPacks" className="min-h-0 flex-1">
        <PackScreen
          active={active && tab === 'contentPacks'}
          embedded
          requestedId={location.packId}
          onSelectedIdChange={(packId, mode) =>
            commitExtensionsLocation({ ...location, tab: 'contentPacks', packId }, mode)
          }
          notify={notify}
        />
      </TabsContent>
    </Tabs>
  );
}

export default ExtensionCenterScreen;

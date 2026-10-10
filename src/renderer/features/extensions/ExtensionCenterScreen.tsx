import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArticleDto, BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import {
  navigationLocationKey,
  type ExtensionsLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import type { CollectionDetailLayoutHandle } from '@/renderer/components/workbench/CollectionDetailLayout';
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
  onArticleSaved(article: ArticleDto): void;
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
  onArticleSaved,
}: Props) {
  const l = useI18n().messages.extensions;
  const active = activeSurface !== null;
  const locationKey = navigationLocationKey(location);
  const appliedLocationKeyRef = useRef(locationKey);
  const [tab, setTab] = useState<'plugins' | 'contentPacks'>(location.tab);
  const root = useRef<HTMLDivElement>(null);
  const collectionRef = useRef<CollectionDetailLayoutHandle>(null);
  const restoreNavigationFocus = useRef(false);

  function commitExtensionsLocation(nextLocation: ExtensionsLocation, mode: NavigationMode = 'push') {
    appliedLocationKeyRef.current = navigationLocationKey(nextLocation);
    onNavigate(nextLocation, mode);
  }

  useEffect(() => {
    if (activeSurface !== 'center' || appliedLocationKeyRef.current === locationKey) return;
    appliedLocationKeyRef.current = locationKey;
    setTab(location.tab);
  }, [activeSurface, locationKey]);

  useLayoutEffect(() => {
    if (!restoreNavigationFocus.current) return;
    restoreNavigationFocus.current = false;
    collectionRef.current?.revealCollection();
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLButtonElement>('[data-extension-center-tabs] [data-state="active"]')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

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

  const collectionHeader = (
    <TabsList
      data-extension-center-tabs
      density="compact"
      aria-label={l.title}
      className="grid h-8 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] border-b-0"
    >
      <TabsTrigger value="plugins" className="min-w-0 px-2" title={l.tabs.plugins}>
        <span className="truncate">{l.tabs.plugins}</span>
      </TabsTrigger>
      <TabsTrigger value="contentPacks" className="min-w-0 px-2" title={l.tabs.contentPacks}>
        <span className="truncate">{l.tabs.contentPacks}</span>
      </TabsTrigger>
    </TabsList>
  );

  return (
    <Tabs
      ref={root}
      value={tab}
      onValueChange={(value) => {
        const nextTab = value as typeof tab;
        if (nextTab === tab) return;
        restoreNavigationFocus.current = true;
        setTab(nextTab);
        commitExtensionsLocation({ ...location, tab: nextTab });
      }}
      className="size-full bg-background"
    >
      <TabsContent value="plugins" className="min-h-0 flex-1">
        <ExtensionPluginScreen
          key={data.spaceId}
          active={active && tab === 'plugins'}
          collectionRef={collectionRef}
          collectionHeader={collectionHeader}
          data={data}
          dataRevision={dataRevision}
          onArticleSaved={onArticleSaved}
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
          collectionRef={collectionRef}
          collectionHeader={collectionHeader}
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

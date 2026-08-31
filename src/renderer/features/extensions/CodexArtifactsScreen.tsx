import { GaugeIcon, ImagesIcon, PanelsTopLeftIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { CodexHistorySearchConfiguration } from '@/renderer/features/extensions/CodexHistorySearchConfiguration';
import { CodexUsageInvestigatorConfiguration } from '@/renderer/features/extensions/CodexUsageInvestigatorConfiguration';
import { CodexVisualizationDiscoveryConfiguration } from '@/renderer/features/extensions/CodexVisualizationDiscoveryConfiguration';
import { ExtensionFeatureErrorBoundary } from '@/renderer/features/extensions/ExtensionFeatureErrorBoundary';

interface Props {
  active: boolean;
  historyExtension: ExtensionDto | null;
  imageExtension: ExtensionDto | null;
  usageExtension: ExtensionDto | null;
  visualizationExtension: ExtensionDto | null;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

type ArtifactTab = 'history' | 'usage' | 'images' | 'visualizations';
const TAB_STORAGE_KEY = 'aiy.codex-artifacts-tab.v2';

function authorized(extension: ExtensionDto | null) {
  return Boolean(
    extension?.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted),
  );
}

function initialTab(): ArtifactTab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    return stored === 'images' || stored === 'usage' || stored === 'visualizations' ? stored : 'history';
  } catch {
    return 'history';
  }
}

export function CodexArtifactsScreen({
  active,
  historyExtension,
  imageExtension,
  usageExtension,
  visualizationExtension,
  notify,
  onOpenCreation,
}: Props) {
  const l = useI18n().messages.extensions.codexArtifacts;
  const historyAvailable = authorized(historyExtension);
  const imageAvailable = authorized(imageExtension);
  const usageAvailable = authorized(usageExtension);
  const visualizationAvailable = authorized(visualizationExtension);
  const [tab, setTab] = useState<ArtifactTab>(initialTab);
  const availableTabs: ArtifactTab[] = [
    ...(historyAvailable ? (['history'] as const) : []),
    ...(usageAvailable ? (['usage'] as const) : []),
    ...(imageAvailable ? (['images'] as const) : []),
    ...(visualizationAvailable ? (['visualizations'] as const) : []),
  ];
  const activeTab = availableTabs.includes(tab) ? tab : (availableTabs[0] ?? tab);

  function changeTab(value: string) {
    const next = value as ArtifactTab;
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // The current surface still works without persisted navigation state.
    }
  }

  if (!historyAvailable && !imageAvailable && !usageAvailable && !visualizationAvailable) {
    return (
      <section className="flex size-full min-h-0 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
          <PanelsTopLeftIcon className="size-4" />
          <h1 className="text-base font-semibold">{l.title}</h1>
        </header>
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>
      </section>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={changeTab} className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <PanelsTopLeftIcon className="size-4" />
        <h1 className="text-base font-semibold">{l.title}</h1>
        <TabsList className="ml-3 h-14 border-0">
          {historyAvailable && (
            <TabsTrigger value="history" className="h-14">
              <SearchIcon className="size-4" />
              {l.tabs.history}
            </TabsTrigger>
          )}
          {usageAvailable && (
            <TabsTrigger value="usage" className="h-14">
              <GaugeIcon className="size-4" />
              {l.tabs.usage}
            </TabsTrigger>
          )}
          {imageAvailable && (
            <TabsTrigger value="images" className="h-14">
              <ImagesIcon className="size-4" />
              {l.tabs.images}
            </TabsTrigger>
          )}
          {visualizationAvailable && (
            <TabsTrigger value="visualizations" className="h-14">
              <PanelsTopLeftIcon className="size-4" />
              {l.tabs.visualizations}
            </TabsTrigger>
          )}
        </TabsList>
      </header>
      {historyExtension && (
        <TabsContent value="history" className="min-h-0 flex-1">
          <ExtensionFeatureErrorBoundary scope={`${historyExtension.manifest.id}:artifacts`}>
            <CodexHistorySearchConfiguration
              active={active && activeTab === 'history'}
              extension={historyExtension}
              standalone
              notify={notify}
            />
          </ExtensionFeatureErrorBoundary>
        </TabsContent>
      )}
      {usageExtension && (
        <TabsContent value="usage" className="min-h-0 flex-1">
          <ExtensionFeatureErrorBoundary scope={`${usageExtension.manifest.id}:artifacts`}>
            <CodexUsageInvestigatorConfiguration
              active={active && activeTab === 'usage'}
              extension={usageExtension}
              standalone
              notify={notify}
            />
          </ExtensionFeatureErrorBoundary>
        </TabsContent>
      )}
      {imageExtension && (
        <TabsContent value="images" className="min-h-0 flex-1">
          <ExtensionFeatureErrorBoundary scope={`${imageExtension.manifest.id}:artifacts`}>
            <CodexImageDiscoveryConfiguration
              active={active && activeTab === 'images'}
              extension={imageExtension}
              standalone
              standaloneHeadingLevel="h2"
              notify={notify}
              onOpenCreation={onOpenCreation}
            />
          </ExtensionFeatureErrorBoundary>
        </TabsContent>
      )}
      {visualizationExtension && (
        <TabsContent value="visualizations" className="min-h-0 flex-1">
          <ExtensionFeatureErrorBoundary scope={`${visualizationExtension.manifest.id}:artifacts`}>
            <CodexVisualizationDiscoveryConfiguration
              active={active && activeTab === 'visualizations'}
              extension={visualizationExtension}
              standalone
              notify={notify}
            />
          </ExtensionFeatureErrorBoundary>
        </TabsContent>
      )}
    </Tabs>
  );
}

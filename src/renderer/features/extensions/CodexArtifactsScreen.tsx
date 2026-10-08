import { History, GaugeIcon, ImagesIcon, Settings } from 'lucide-react';
import { Activity, useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { CodexHistorySearchConfiguration } from '@/renderer/features/extensions/CodexHistorySearchConfiguration';
import { CodexUsageInvestigatorConfiguration } from '@/renderer/features/extensions/CodexUsageInvestigatorConfiguration';
import { CodexVisualizationDiscoveryConfiguration } from '@/renderer/features/extensions/CodexVisualizationDiscoveryConfiguration';
import { ExtensionFeatureErrorBoundary } from '@/renderer/features/extensions/ExtensionFeatureErrorBoundary';
import { CodexFlowerSettings } from '@/renderer/features/extensions/codex-content/CodexFlowerSettings';
import './codex-artifacts-screen.css';

interface Props {
  active: boolean;
  extension: ExtensionDto | null;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}
type WorkspaceTab = 'history' | 'materials' | 'usage' | 'settings';
const TAB_STORAGE_KEY = 'aiy.codex-artifacts-tab.v3';
function initialTab(): WorkspaceTab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'images' || stored === 'visualizations' || stored === 'materials') return 'materials';
    return stored === 'usage' || stored === 'settings' ? stored : 'history';
  } catch {
    return 'history';
  }
}
export function CodexArtifactsScreen({ active, extension, notify, onOpenCreation }: Props) {
  const messages = useI18n().messages,
    copy = messages.desktopPetals,
    l = messages.extensions.codexArtifacts;
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [materialTab, setMaterialTab] = useState('images');
  const [historyToggleHost, setHistoryToggleHost] = useState<HTMLDivElement | null>(null);
  const [usageToggleHost, setUsageToggleHost] = useState<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState(() => new Set<WorkspaceTab>([tab]));
  const change = (next: string) => {
    setTab(next as WorkspaceTab);
    setVisited((current) => new Set([...current, next as WorkspaceTab]));
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* Optional navigation preference. */
    }
  };
  if (
    !extension?.enabled ||
    !extension.compatible ||
    extension.permissions.some((permission) => permission.required && !permission.granted)
  ) {
    return (
      <div className="flex size-full flex-col items-start justify-center gap-3 p-5">
        <span role="status" className="text-sm text-muted-foreground">
          {l.unavailable}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.desktopPetals.codex
              .command({ kind: 'open-settings' })
              .catch(() => notify(copy.codex.errors.execution))
          }
        >
          {copy.codex.settings}
        </Button>
      </div>
    );
  }
  return (
    <Tabs
      value={tab}
      onValueChange={change}
      data-codex-artifacts-screen
      className="grid size-full grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-background"
    >
      <div className="relative z-10 col-start-2 row-start-1 flex min-w-0 items-center border-b bg-background px-3">
        <div ref={setHistoryToggleHost} className={tab === 'history' ? 'mr-2 flex shrink-0 empty:hidden' : 'hidden'} />
        <div ref={setUsageToggleHost} className={tab === 'usage' ? 'mr-2 flex shrink-0 empty:hidden' : 'hidden'} />
        <TabsList className="min-w-0 flex-1 overflow-x-auto border-b-0" aria-label={copy.codex.title}>
          {(
            [
              ['history', History, l.tabs.history],
              ['materials', ImagesIcon, copy.codex.materials],
              ['usage', GaugeIcon, l.tabs.usage],
              ['settings', Settings, copy.codex.settings],
            ] as const
          ).map(([value, Icon, label]) => (
            <TabsTrigger key={value} value={value} className="h-12 shrink-0 gap-2">
              <Icon className="size-4" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {visited.has('history') && (
        <Activity mode={tab === 'history' ? 'visible' : 'hidden'}>
          <TabsContent
            forceMount
            value="history"
            hidden={tab !== 'history'}
            className="col-span-2 col-start-1 row-span-2 row-start-1 grid min-w-0 grid-cols-subgrid grid-rows-subgrid data-[state=inactive]:hidden"
          >
            <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':history'}>
              <CodexHistorySearchConfiguration
                active={active && tab === 'history'}
                extension={extension}
                standalone
                navigationToggleHost={historyToggleHost}
                notify={notify}
              />
            </ExtensionFeatureErrorBoundary>
          </TabsContent>
        </Activity>
      )}
      <TabsContent value="materials" className="col-span-2 row-start-2 min-h-0 min-w-0">
        <Tabs value={materialTab} onValueChange={setMaterialTab} className="size-full">
          <TabsList className="max-w-full shrink-0 overflow-x-auto px-3">
            <TabsTrigger value="images" className="shrink-0">
              {l.tabs.images}
            </TabsTrigger>
            <TabsTrigger value="visualizations" className="shrink-0">
              {l.tabs.visualizations}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="images" className="min-h-0 flex-1">
            <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':images'}>
              <CodexImageDiscoveryConfiguration
                active={active && tab === 'materials' && materialTab === 'images'}
                extension={extension}
                standalone
                standaloneHeadingLevel="h2"
                notify={notify}
                onOpenCreation={onOpenCreation}
              />
            </ExtensionFeatureErrorBoundary>
          </TabsContent>
          <TabsContent value="visualizations" className="min-h-0 flex-1">
            <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':visualizations'}>
              <CodexVisualizationDiscoveryConfiguration
                active={active && tab === 'materials' && materialTab === 'visualizations'}
                extension={extension}
                standalone
                notify={notify}
              />
            </ExtensionFeatureErrorBoundary>
          </TabsContent>
        </Tabs>
      </TabsContent>
      {visited.has('usage') && (
        <Activity mode={tab === 'usage' ? 'visible' : 'hidden'}>
          <TabsContent
            forceMount
            value="usage"
            hidden={tab !== 'usage'}
            className="col-span-2 col-start-1 row-span-2 row-start-1 grid min-w-0 grid-cols-subgrid grid-rows-subgrid data-[state=inactive]:hidden"
          >
            <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':usage'}>
              <CodexUsageInvestigatorConfiguration
                active={active && tab === 'usage'}
                extension={extension}
                standalone
                navigationToggleHost={usageToggleHost}
                notify={notify}
              />
            </ExtensionFeatureErrorBoundary>
          </TabsContent>
        </Activity>
      )}
      <TabsContent value="settings" className="col-span-2 row-start-2 min-h-0 min-w-0 overflow-y-auto">
        <CodexFlowerSettings active={active && tab === 'settings'} />
      </TabsContent>
    </Tabs>
  );
}

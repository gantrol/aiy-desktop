import { History, GaugeIcon, ImagesIcon, Settings } from 'lucide-react';
import { useState } from 'react';
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
  const change = (next: string) => {
    setTab(next as WorkspaceTab);
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
    <Tabs value={tab} onValueChange={change} className="size-full bg-background">
      <TabsList className="shrink-0 px-3" aria-label={copy.codex.title}>
        {(
          [
            ['history', History, l.tabs.history],
            ['materials', ImagesIcon, copy.codex.materials],
            ['usage', GaugeIcon, l.tabs.usage],
            ['settings', Settings, copy.codex.settings],
          ] as const
        ).map(([value, Icon, label]) => (
          <TabsTrigger key={value} value={value} className="h-12 gap-2">
            <Icon className="size-4" />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="history" className="min-h-0 flex-1">
        <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':history'}>
          <CodexHistorySearchConfiguration
            active={active && tab === 'history'}
            extension={extension}
            standalone
            notify={notify}
          />
        </ExtensionFeatureErrorBoundary>
      </TabsContent>
      <TabsContent value="materials" className="min-h-0 flex-1">
        <Tabs value={materialTab} onValueChange={setMaterialTab} className="size-full">
          <TabsList className="shrink-0 px-3">
            <TabsTrigger value="images">{l.tabs.images}</TabsTrigger>
            <TabsTrigger value="visualizations">{l.tabs.visualizations}</TabsTrigger>
            <Button
              variant="ghost"
              size="xs"
              className="mb-1 ml-auto"
              onClick={() =>
                void window.desktopPetals.codex
                  .command({ kind: 'open-album' })
                  .catch(() => notify(copy.codex.errors.collection))
              }
            >
              {copy.actions.gallery}
            </Button>
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
      <TabsContent value="usage" className="min-h-0 flex-1">
        <ExtensionFeatureErrorBoundary scope={extension.manifest.id + ':usage'}>
          <CodexUsageInvestigatorConfiguration
            active={active && tab === 'usage'}
            extension={extension}
            standalone
            notify={notify}
          />
        </ExtensionFeatureErrorBoundary>
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto">
        <CodexFlowerSettings active={active && tab === 'settings'} />
      </TabsContent>
    </Tabs>
  );
}

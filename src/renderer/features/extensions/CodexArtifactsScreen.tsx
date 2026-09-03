import { GaugeIcon, ImagesIcon, PanelsTopLeftIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { CodexHistorySearchConfiguration } from '@/renderer/features/extensions/CodexHistorySearchConfiguration';
import { CodexUsageInvestigatorConfiguration } from '@/renderer/features/extensions/CodexUsageInvestigatorConfiguration';
import { CodexVisualizationDiscoveryConfiguration } from '@/renderer/features/extensions/CodexVisualizationDiscoveryConfiguration';
import { ExtensionFeatureErrorBoundary } from '@/renderer/features/extensions/ExtensionFeatureErrorBoundary';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto | null;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

type ArtifactTab = 'history' | 'usage' | 'images' | 'visualizations';
const TAB_STORAGE_KEY = 'aiy.codex-artifacts-tab.v3';

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

export function CodexArtifactsScreen({ active, extension, notify, onOpenCreation }: Props) {
  const l = useI18n().messages.extensions.codexArtifacts;
  const [tab, setTab] = useState<ArtifactTab>(initialTab);

  function changeTab(next: ArtifactTab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // The workspace remains usable without persisted navigation state.
    }
  }

  const navigation = (
    <nav className="grid gap-0.5" aria-label={l.title}>
      {(
        [
          ['history', SearchIcon, l.tabs.history],
          ['usage', GaugeIcon, l.tabs.usage],
          ['images', ImagesIcon, l.tabs.images],
          ['visualizations', PanelsTopLeftIcon, l.tabs.visualizations],
        ] as const
      ).map(([value, Icon, label]) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="sm"
          data-current={tab === value || undefined}
          className="w-full justify-start px-2 text-xs font-normal data-[current]:bg-selected data-[current]:font-semibold data-[current]:text-selected-foreground"
          onClick={() => changeTab(value)}
        >
          <Icon className="size-4" />
          {label}
        </Button>
      ))}
    </nav>
  );

  if (!authorized(extension) || !extension) {
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

  const feature =
    tab === 'usage' ? (
      <CodexUsageInvestigatorConfiguration
        active={active}
        extension={extension}
        standalone
        workspaceNavigation={navigation}
        notify={notify}
      />
    ) : tab === 'images' ? (
      <CodexImageDiscoveryConfiguration
        active={active}
        extension={extension}
        standalone
        standaloneHeadingLevel="h2"
        notify={notify}
        onOpenCreation={onOpenCreation}
      />
    ) : (
      <CodexVisualizationDiscoveryConfiguration active={active} extension={extension} standalone notify={notify} />
    );

  return (
    <section className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex min-h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden">
        {(
          [
            ['history', SearchIcon, l.tabs.history],
            ['usage', GaugeIcon, l.tabs.usage],
            ['images', ImagesIcon, l.tabs.images],
            ['visualizations', PanelsTopLeftIcon, l.tabs.visualizations],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? 'secondary' : 'ghost'}
            size="sm"
            className="min-w-0 flex-1 px-2 text-xs"
            title={label}
            onClick={() => changeTab(value)}
          >
            <Icon className="size-4 shrink-0" />
            <span className="hidden min-[520px]:inline">{label}</span>
          </Button>
        ))}
      </header>
      <div className="min-h-0 flex-1">
        {tab === 'history' ? (
          <ExtensionFeatureErrorBoundary scope={`${extension.manifest.id}:history`}>
            <CodexHistorySearchConfiguration
              active={active}
              extension={extension}
              standalone
              workspaceNavigation={navigation}
              notify={notify}
            />
          </ExtensionFeatureErrorBoundary>
        ) : (
          <div className="flex size-full min-h-0">
            {tab !== 'usage' && (
              <aside className="hidden h-full w-60 shrink-0 border-r bg-surface-sunken/20 p-2 md:block">
                {navigation}
              </aside>
            )}
            <div className={cn('min-w-0 flex-1', !active && 'pointer-events-none')}>
              <ExtensionFeatureErrorBoundary scope={`${extension.manifest.id}:${tab}`}>
                {feature}
              </ExtensionFeatureErrorBoundary>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

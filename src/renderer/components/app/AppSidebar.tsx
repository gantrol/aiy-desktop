import { SettingsIcon } from 'lucide-react';
import type { AppView } from '@/renderer/components/app/app-navigation';
import { navigationItems } from '@/renderer/components/app/app-navigation-items';
import { getExtensionNavigationItems } from '@/renderer/features/extensions/extension-navigation-items';
import { AppSidebarButton } from '@/renderer/components/app/AppSidebarButton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { LocalSpaceSwitcher } from '@/renderer/components/spaces/LocalSpaceSwitcher';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';

interface Props {
  spaceName: string;
  spaceCoverUrl: string | null;
  spaceTransitioning: boolean;
  libraryBusy: boolean;
  codexImagesVisible: boolean;
  transitionShowcaseVisible: boolean;
  view: AppView;
  onViewChange(view: AppView): void;
  onSettingsOpen(): void;
  notify(message: string): void;
}

export function AppSidebar({
  spaceName,
  spaceCoverUrl,
  spaceTransitioning,
  libraryBusy,
  codexImagesVisible,
  transitionShowcaseVisible,
  view,
  onViewChange,
  onSettingsOpen,
  notify,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.app.navigation;
  const visibleItems = [
    ...navigationItems,
    ...getExtensionNavigationItems({ codexImagesVisible, transitionShowcaseVisible }),
  ];
  return (
    <TooltipProvider>
      <aside
        className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 overflow-hidden border-r bg-muted py-3"
        aria-label={labels.label}
      >
        <div className="mb-2 shrink-0">
          <LocalSpaceSwitcher
            spaceName={spaceName}
            spaceCoverUrl={spaceCoverUrl}
            busy={libraryBusy}
            transitioning={spaceTransitioning}
            notify={notify}
          />
        </div>
        <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto">
          {visibleItems.map(({ id, icon, activeViews }) => {
            const current = activeViews.includes(view);
            return (
              <AppSidebarButton
                key={id}
                data-view={id}
                icon={icon}
                label={labels[id]}
                selected={current}
                disabled={spaceTransitioning}
                onClick={() => onViewChange(id)}
                aria-current={current ? 'page' : undefined}
              />
            );
          })}
        </nav>
        <AppSidebarButton
          data-action="settings"
          icon={SettingsIcon}
          label={labels.settings}
          compact
          selected={view === 'contentManagement'}
          disabled={spaceTransitioning}
          aria-current={view === 'contentManagement' ? 'page' : undefined}
          onClick={onSettingsOpen}
        />
      </aside>
    </TooltipProvider>
  );
}

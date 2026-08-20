import {
  ActivityIcon,
  BlocksIcon,
  ImagesIcon,
  ScanSearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
} from 'lucide-react';
import { DictionaryIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { LocalSpaceSwitcher } from '@/renderer/components/spaces/LocalSpaceSwitcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export type AppView =
  'creator' | 'documents' | 'dictionary' | 'gallery' | 'codexImages' | 'transitionShowcase' | 'packs' | 'aiCenter';

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

const items = [
  { id: 'creator', icon: SquarePenIcon },
  { id: 'dictionary', icon: DictionaryIcon },
  { id: 'gallery', icon: ImagesIcon },
  { id: 'codexImages', icon: ScanSearchIcon },
  { id: 'transitionShowcase', icon: SlidersHorizontalIcon },
  { id: 'packs', icon: BlocksIcon },
  { id: 'aiCenter', icon: ActivityIcon },
] as const;

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
  const visibleItems = items.filter(
    ({ id }) =>
      (id !== 'codexImages' || codexImagesVisible) && (id !== 'transitionShowcase' || transitionShowcaseVisible),
  );
  return (
    <TooltipProvider>
      <aside
        className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 overflow-hidden border-r bg-muted px-2 py-3"
        aria-label={labels.label}
      >
        <div className="mb-2">
          <LocalSpaceSwitcher
            spaceName={spaceName}
            spaceCoverUrl={spaceCoverUrl}
            busy={libraryBusy}
            transitioning={spaceTransitioning}
            notify={notify}
          />
        </div>
        <nav className="flex w-full flex-col items-center gap-2">
          {visibleItems.map(({ id, icon: Icon }) => {
            const current = id === 'creator' ? view === 'creator' || view === 'documents' : view === id;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    data-view={id}
                    variant="ghost"
                    disabled={spaceTransitioning}
                    className={cn(
                      'relative h-14 w-14 flex-col gap-1 rounded-md px-0 text-[10px] font-normal whitespace-nowrap text-muted-foreground',
                      'focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong',
                      current &&
                        'bg-selected font-semibold text-selected-foreground hover:bg-selected active:bg-selected',
                    )}
                    onClick={() => onViewChange(id)}
                    aria-current={current ? 'page' : undefined}
                    aria-label={labels[id]}
                  >
                    <Icon className="size-5" />
                    <span>{labels[id]}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{labels[id]}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-action="settings"
                variant="ghost"
                size="icon"
                disabled={spaceTransitioning}
                aria-label={labels.settings}
                onClick={onSettingsOpen}
              >
                <SettingsIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{labels.settings}</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}

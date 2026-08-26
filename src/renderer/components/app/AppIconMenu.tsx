import {
  ActivityIcon,
  BlocksIcon,
  CheckIcon,
  ChevronDownIcon,
  ImagesIcon,
  LogOutIcon,
  ScanSearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
} from 'lucide-react';
import { useState } from 'react';
import { DictionaryIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import type { AppView } from '@/renderer/components/app/AppSidebar';

interface Props {
  view: AppView;
  disabled: boolean;
  codexImagesVisible: boolean;
  transitionShowcaseVisible: boolean;
  onNewCreation(): void;
  onViewChange(view: AppView): void;
  onSettingsOpen(): void;
  onQuit(): void;
}

const viewItems = [
  { id: 'creator', icon: SquarePenIcon },
  { id: 'dictionary', icon: DictionaryIcon },
  { id: 'gallery', icon: ImagesIcon },
  { id: 'codexImages', icon: ScanSearchIcon },
  { id: 'transitionShowcase', icon: SlidersHorizontalIcon },
  { id: 'packs', icon: BlocksIcon },
  { id: 'aiCenter', icon: ActivityIcon },
] as const;

export function AppIconMenu({
  view,
  disabled,
  codexImagesVisible,
  transitionShowcaseVisible,
  onNewCreation,
  onViewChange,
  onSettingsOpen,
  onQuit,
}: Props) {
  const [open, setOpen] = useState(false);
  const { messages } = useI18n();
  const labels = messages.app.menu;
  const navigation = messages.app.navigation;
  const visibleViewItems = viewItems.filter(
    ({ id }) =>
      (id !== 'codexImages' || codexImagesVisible) && (id !== 'transitionShowcase' || transitionShowcaseVisible),
  );

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-action="app-menu"
          variant="ghost"
          disabled={disabled}
          className="-ml-1.5 h-7 min-w-0 max-w-64 gap-1.5 px-1.5 text-xs font-medium"
          aria-label={labels.open}
          aria-expanded={open}
        >
          <img className="size-4 shrink-0" src="./icon.png" alt="" />
          <span className="truncate text-foreground">{messages.app.title}</span>
          <ChevronDownIcon
            className={cn('size-3 text-muted-foreground transition-transform duration-fast', open && 'rotate-180')}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-60 p-1.5" aria-label={labels.label}>
        <Button
          type="button"
          data-action="app-menu-new-creation"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2 font-normal"
          aria-keyshortcuts="Control+N Meta+N"
          onClick={() => select(onNewCreation)}
        >
          <SquarePenIcon className="size-4" />
          <span>{labels.newCreation}</span>
          <KbdGroup className="ml-auto">
            <Kbd>Ctrl</Kbd>
            <Kbd>N</Kbd>
          </KbdGroup>
        </Button>

        <div className="-mx-0.5 my-1 h-px bg-border" />

        <nav className="grid gap-0.5" aria-label={navigation.label}>
          {visibleViewItems.map(({ id, icon: Icon }) => {
            const current = id === 'creator' ? view === 'creator' || view === 'documents' : view === id;
            return (
              <Button
                key={id}
                type="button"
                data-app-menu-view={id}
                variant="ghost"
                className={cn(
                  'h-9 w-full justify-start gap-2 px-2 font-normal',
                  current && 'bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
                )}
                aria-current={current ? 'page' : undefined}
                onClick={() => select(() => onViewChange(id))}
              >
                <Icon className="size-4" />
                <span>{navigation[id]}</span>
                {current && <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
              </Button>
            );
          })}
        </nav>

        <div className="-mx-0.5 my-1 h-px bg-border" />

        <Button
          type="button"
          data-action="app-menu-settings"
          variant="ghost"
          className={cn(
            'h-9 w-full justify-start gap-2 px-2 font-normal',
            view === 'contentManagement' && 'bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
          )}
          aria-current={view === 'contentManagement' ? 'page' : undefined}
          onClick={() => select(onSettingsOpen)}
        >
          <SettingsIcon className="size-4" />
          <span>{navigation.settings}</span>
          {view === 'contentManagement' && <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          data-action="app-menu-quit"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2 font-normal text-destructive hover:text-destructive"
          onClick={() => select(onQuit)}
        >
          <LogOutIcon className="size-4" />
          <span>{labels.quit}</span>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

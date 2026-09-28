import { CheckIcon, ChevronDownIcon, CompassIcon, LogOutIcon, SettingsIcon, SquarePenIcon } from 'lucide-react';
import { useState } from 'react';
import { AiyIdentity } from '@/renderer/components/brand/AiyIdentity';
import { navigationItems } from '@/renderer/components/app/app-navigation-items';
import { getExtensionNavigationItems } from '@/renderer/features/extensions/extension-navigation-items';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';
import { commandAriaShortcut, commandShortcutText } from '@/renderer/commands/app-shortcuts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import type { AppView } from '@/renderer/components/app/app-navigation';
import { DesktopPetalsMenuAction } from '@/renderer/features/desktop-petals/DesktopPetalsMenuAction';

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
  const platform = window.desktopApi.appPlatform;
  const newCreationShortcut = commandShortcutText('app.new', platform).split('+');
  const labels = messages.app.menu;
  const navigation = messages.app.navigation;
  const visibleViewItems = [
    ...navigationItems,
    ...getExtensionNavigationItems({ codexImagesVisible, transitionShowcaseVisible }),
  ];

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-action="app-menu"
          variant="ghost"
          disabled={disabled}
          className="-ml-1.5 h-7 min-w-0 max-w-64 gap-1.5 px-1.5 text-xs font-medium"
          aria-label={labels.open}
          aria-expanded={open}
        >
          <AiyIdentity avatar className="size-4 shrink-0" />
          <span className="truncate text-foreground">{messages.app.title}</span>
          <ChevronDownIcon
            className={cn('size-3 text-muted-foreground transition-transform duration-fast', open && 'rotate-180')}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-60 p-1.5" aria-label={labels.label}>
        <DropdownMenuItem
          data-action="app-menu-new-creation"
          className="h-9 w-full justify-start gap-2 px-2 font-normal"
          aria-keyshortcuts={commandAriaShortcut('app.new', platform)}
          onSelect={() => select(onNewCreation)}
        >
          <SquarePenIcon className="size-4" />
          <span>{labels.newCreation}</span>
          <KbdGroup className="ml-auto">
            {newCreationShortcut.map((token) => (
              <Kbd key={token}>{token}</Kbd>
            ))}
          </KbdGroup>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 gap-2 px-2 font-normal">
            <CompassIcon className="size-4" />
            <span>{navigation.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-60" aria-label={navigation.label}>
              {visibleViewItems.map(({ id, icon: Icon, activeViews }) => {
                const current = activeViews.includes(view);
                return (
                  <DropdownMenuItem
                    key={id}
                    data-app-menu-view={id}
                    className={cn(
                      'h-9 w-full justify-start gap-2 px-2 font-normal',
                      current &&
                        'bg-selected text-selected-foreground data-[highlighted]:bg-selected data-[highlighted]:text-selected-foreground',
                    )}
                    aria-current={current ? 'page' : undefined}
                    onSelect={() => select(() => onViewChange(id))}
                  >
                    <Icon className="size-4" />
                    <span>{navigation[id]}</span>
                    {current && <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DesktopPetalsMenuAction onOpened={() => setOpen(false)} />
        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-action="app-menu-settings"
          className={cn(
            'h-9 w-full justify-start gap-2 px-2 font-normal',
            view === 'contentManagement' &&
              'bg-selected text-selected-foreground data-[highlighted]:bg-selected data-[highlighted]:text-selected-foreground',
          )}
          aria-current={view === 'contentManagement' ? 'page' : undefined}
          onSelect={() => select(onSettingsOpen)}
        >
          <SettingsIcon className="size-4" />
          <span>{navigation.settings}</span>
          {view === 'contentManagement' && <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-action="app-menu-quit"
          className="h-9 w-full justify-start gap-2 px-2 font-normal"
          onSelect={() => select(onQuit)}
        >
          <LogOutIcon className="size-4" />
          <span>{labels.quit}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useState } from 'react';
import { InfoIcon, SettingsIcon } from 'lucide-react';
import type { AppView } from '@/renderer/components/app/app-navigation';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import { useHoverDropdown } from '@/renderer/components/ui/use-hover-dropdown';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { useProfileSummary } from '@/renderer/features/me/SpaceProfileProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export function MeMenu({
  view,
  spaceName,
  disabled,
  onNavigate,
}: {
  view: AppView;
  spaceName: string;
  disabled: boolean;
  onNavigate(view: 'me' | 'settings' | 'about'): void;
}) {
  const { messages } = useI18n();
  const profile = useProfileSummary();
  const [open, setOpen] = useState(false);
  const hover = useHoverDropdown(open, setOpen, disabled);
  function select(target: 'me' | 'settings' | 'about') {
    hover.rootProps.onOpenChange(false);
    onNavigate(target);
  }
  return (
    <DropdownMenu {...hover.rootProps}>
      <DropdownMenuTrigger
        asChild
        {...hover.triggerProps}
        onPointerDown={(event) => {
          if (event.button === 0 && !event.ctrlKey) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!disabled) select('me');
          } else hover.triggerProps.onKeyDown?.(event);
        }}
      >
        <Button
          type="button"
          variant="ghost"
          data-view="me"
          aria-label={messages.me.title}
          aria-current={view === 'me' ? 'page' : undefined}
          disabled={disabled}
          className={cn(
            'size-10 shrink-0 p-1 focus-visible:ring-inset',
            ['me', 'settings', 'about'].includes(view) && 'bg-selected text-selected-foreground',
          )}
          onClick={() => select('me')}
          onContextMenu={(event) => {
            event.preventDefault();
            hover.rootProps.onOpenChange(true);
          }}
        >
          <ProfileAvatar src={profile?.avatarDataUrl} className="size-7 bg-transparent" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...hover.contentProps} side="right" align="end" className="w-56">
        <DropdownMenuItem onSelect={() => select('me')} className="gap-3 py-3" aria-label={messages.me.title}>
          <ProfileAvatar src={profile?.avatarDataUrl} className="size-9" />
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-medium">{profile?.authorName || messages.me.title}</span>
            <span className="truncate text-xs text-muted-foreground">{spaceName}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select('settings')}>
          <SettingsIcon />
          {messages.app.navigation.settings}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => select('about')}>
          <InfoIcon />
          {messages.app.navigation.about}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { CircleAlert, Eye, EyeOff, House, ListChecks, LogOut, Settings2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { AIYFlowerMark } from '@/renderer/components/brand/AIYFlowerMark';
import { Button } from '@/renderer/components/ui/button';
import { Separator } from '@/renderer/components/ui/separator';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { trayTaskStatus, type TrayMenuAction, type TrayMenuState } from '@/shared/contracts/tray-menu';

const petalItems = [
  { action: 'petals-open', icon: AIYFlowerMark },
  { action: 'petals-show-all', icon: Eye },
  { action: 'petals-hide-all', icon: EyeOff },
  { action: 'petals-settings', icon: Settings2 },
] as const;

/** Shared by the live tray window and the isolated demo's final click. */
export function TrayMenuItems({
  state,
  onAction,
  preview = false,
  previewQuitFocused = false,
}: {
  state: Pick<TrayMenuState, 'taskCount' | 'windowReady' | 'quittingSoon'> &
    Partial<Pick<TrayMenuState, 'petalsReady'>>;
  onAction(action: TrayMenuAction): void;
  previewQuitFocused?: boolean;
  preview?: boolean;
}) {
  const copy = useI18n().messages.appShell;
  const Item = preview ? TrayPreviewItem : DropdownMenuItem;
  const Divider = preview ? Separator : DropdownMenuSeparator;
  return (
    <>
      <Item disabled={!state.windowReady} onSelect={() => onAction('open')}>
        <House />
        {copy.open}
      </Item>
      <Divider className="-mx-1 my-1" />
      {!preview && (
        <>
          {petalItems.map(({ action, icon: Icon }) => (
            <Item key={action} disabled={!state.petalsReady} onSelect={() => onAction(action)}>
              <Icon />
              {copy[action]}
            </Item>
          ))}
          <Divider className="-mx-1 my-1" />
        </>
      )}
      <Item disabled>
        <ListChecks />
        {trayTaskStatus(state, copy)}
      </Item>
      <Divider className="-mx-1 my-1" />
      <Item
        data-demo-tray-quit
        className={cn(previewQuitFocused && 'bg-hover ring-2 ring-inset ring-ring')}
        onSelect={() => onAction('quit')}
      >
        <LogOut />
        {state.taskCount > 0 ? copy.quitPending : copy.quit}
      </Item>
      {state.taskCount > 0 && (
        <Item onSelect={() => onAction('force-quit')}>
          <CircleAlert />
          {copy.forceQuitPending}
        </Item>
      )}
    </>
  );
}

/** Uses the same copy, order and dimensions without opening a portal or issuing native actions. */
function TrayPreviewItem({
  className,
  children,
  disabled,
  'data-demo-tray-quit': quit,
}: Pick<ComponentProps<typeof DropdownMenuItem>, 'className' | 'children' | 'disabled' | 'onSelect'> & {
  'data-demo-tray-quit'?: boolean;
}) {
  return (
    <Button
      data-demo-tray-quit={quit}
      variant="ghost"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      className={cn('h-8 min-h-8 w-full justify-start gap-2 rounded-sm px-2 py-1.5 font-normal', className)}
    >
      {children}
    </Button>
  );
}

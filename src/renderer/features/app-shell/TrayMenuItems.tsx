import { CircleAlert, House, ListChecks, LogOut } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Separator } from '@/renderer/components/ui/separator';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/renderer/components/ui/dropdown-menu';
import { petalMenuItemClass, petalMenuSeparatorClass } from '@/renderer/features/desktop-petals/petal-menu-style';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { trayTaskStatus, type TrayMenuAction, type TrayMenuState } from '@/shared/contracts/tray-menu';

/** Shared by the live tray window and the isolated demo's final click. */
export function TrayMenuItems({
  state,
  onAction,
  preview = false,
  previewQuitFocused = false,
}: {
  state: Pick<TrayMenuState, 'taskCount' | 'windowReady' | 'quittingSoon'>;
  onAction(action: TrayMenuAction): void;
  previewQuitFocused?: boolean;
  preview?: boolean;
}) {
  const copy = useI18n().messages.appShell;
  const Item = preview ? TrayPreviewItem : DropdownMenuItem;
  const Divider = preview ? Separator : DropdownMenuSeparator;
  return (
    <>
      <Item className={petalMenuItemClass} disabled={!state.windowReady} onSelect={() => onAction('open')}>
        <House />
        {copy.open}
      </Item>
      <Divider className={cn(petalMenuSeparatorClass, '-mx-1 my-1')} />
      <Item className={cn(petalMenuItemClass, 'data-[disabled]:text-inherit data-[disabled]:opacity-60')} disabled>
        <ListChecks />
        {trayTaskStatus(state, copy)}
      </Item>
      <Divider className={cn(petalMenuSeparatorClass, '-mx-1 my-1')} />
      <Item
        data-demo-tray-quit
        className={cn(
          petalMenuItemClass,
          previewQuitFocused && 'bg-[var(--petal-edge)]/20 ring-2 ring-inset ring-[var(--petal-ink)]',
        )}
        onSelect={() => onAction('quit')}
      >
        <LogOut />
        {state.taskCount > 0 ? copy.quitPending : copy.quit}
      </Item>
      {state.taskCount > 0 && (
        <Item className={petalMenuItemClass} onSelect={() => onAction('force-quit')}>
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

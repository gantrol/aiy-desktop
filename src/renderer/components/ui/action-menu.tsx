import type { LucideIcon } from 'lucide-react';
import { EllipsisIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { ContextMenuIcon, ContextMenuItem, ContextMenuSeparator } from '@/renderer/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

export interface ActionMenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}

export function ActionContextMenuItems({ actions }: { actions: readonly ActionMenuAction[] }) {
  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.id}>
            {action.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem
              data-action-id={action.id}
              disabled={action.disabled}
              variant={action.destructive ? 'destructive' : 'default'}
              onSelect={action.onSelect}
            >
              <ContextMenuIcon>
                <Icon />
              </ContextMenuIcon>
              {action.label}
            </ContextMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}

export function ActionMenuButton({
  actions,
  label,
  className,
}: {
  actions: readonly ActionMenuAction[];
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-slot="action-menu-trigger"
          variant="ghost"
          size="icon-sm"
          className={cn('size-7 shrink-0', className)}
          aria-label={label}
          title={label}
        >
          <EllipsisIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-48 p-1.5">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <div key={action.id}>
              {action.separatorBefore && <div className="-mx-1 mb-1 mt-1 h-px bg-border" />}
              <Button
                type="button"
                data-action-id={action.id}
                variant="ghost"
                disabled={action.disabled}
                className={cn(
                  'h-8 w-full justify-start gap-2 px-2 font-normal',
                  action.destructive && 'text-destructive hover:text-destructive',
                )}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
              >
                <Icon className="size-3.5" />
                {action.label}
              </Button>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

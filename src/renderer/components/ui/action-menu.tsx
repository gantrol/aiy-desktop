import type { LucideIcon } from 'lucide-react';
import { EllipsisIcon } from 'lucide-react';
import { Fragment, useState, type ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { ContextMenuIcon, ContextMenuItem, ContextMenuSeparator } from '@/renderer/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';

export interface ActionMenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  busy?: boolean;
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
                <Icon className={action.busy ? 'animate-spin' : undefined} />
              </ContextMenuIcon>
              {action.label}
            </ContextMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}

function ActionDropdownMenuItems({ actions }: { actions: readonly ActionMenuAction[] }) {
  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.id}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              data-action-id={action.id}
              disabled={action.disabled}
              variant={action.destructive ? 'destructive' : 'default'}
              onSelect={action.onSelect}
            >
              <DropdownMenuIcon>
                <Icon className={action.busy ? 'animate-spin' : undefined} />
              </DropdownMenuIcon>
              {action.label}
            </DropdownMenuItem>
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
  contentClassName,
  side = 'right',
  align = 'start',
  variant = 'ghost',
}: {
  actions: readonly ActionMenuAction[];
  label: string;
  className?: string;
  contentClassName?: string;
  side?: ComponentProps<typeof DropdownMenuContent>['side'];
  align?: ComponentProps<typeof DropdownMenuContent>['align'];
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-slot="action-menu-trigger"
          variant={variant}
          size="icon-sm"
          className={cn('size-7 shrink-0', className)}
          aria-label={label}
          title={label}
          aria-busy={actions.some((action) => action.busy) || undefined}
        >
          <EllipsisIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent side={side} align={align} className={cn('w-48', contentClassName)}>
          <ActionDropdownMenuItems actions={actions} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

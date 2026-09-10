import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronRightIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { useOverlayPortalContainer } from '@/renderer/components/ui/overlay-layer';

function DropdownMenuIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:shrink-0', className)}
      {...props}
    />
  );
}

function DropdownMenu({ modal = false, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />;
}

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;

function DropdownMenuPortal({ container, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  const inheritedContainer = useOverlayPortalContainer();
  return <DropdownMenuPrimitive.Portal container={container ?? inheritedContainer ?? undefined} {...props} />;
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  style,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-overlay-layer="popup"
        data-overlay-surface=""
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'pointer-events-auto z-popup min-w-40 overflow-hidden rounded-md border border-border bg-overlay p-1 text-foreground shadow-overlay outline-none',
          className,
        )}
        style={{ ...style, pointerEvents: 'auto' }}
        {...props}
      />
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none transition-colors duration-fast data-[highlighted]:bg-hover data-[highlighted]:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground data-[disabled]:opacity-100 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive-surface data-[variant=destructive]:data-[highlighted]:text-destructive [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        'flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none transition-colors duration-fast data-[highlighted]:bg-hover data-[state=open]:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground data-[disabled]:opacity-100',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      data-overlay-layer="popup"
      data-overlay-surface=""
      className={cn(
        'pointer-events-auto z-popup min-w-40 overflow-hidden rounded-md border border-border bg-overlay p-1 text-foreground shadow-overlay outline-none',
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};

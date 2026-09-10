import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { DropdownMenuContent, DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';

/** Portals cannot escape a native window. Keep petal menus within one bounded surface. */
export function PetalMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      collisionPadding={8}
      className={cn(
        'max-h-[var(--radix-dropdown-menu-content-available-height)] w-50 min-w-0 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain bg-popover text-popover-foreground shadow-none [&_[role^=menuitem]]:text-xs',
        className,
      )}
      {...props}
    />
  );
}

/** Inline choices need no extra horizontal space and share the menu's scrolling and keyboard order. */
export function PetalMenuSection({
  icon: Icon,
  label,
  disabled = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' || !open) return;
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <DropdownMenuItem
        asChild
        disabled={disabled}
        className="w-full"
        onSelect={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' || disabled) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <CollapsibleTrigger ref={trigger}>
          <Icon />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className={open ? 'rotate-180' : undefined} />
        </CollapsibleTrigger>
      </DropdownMenuItem>
      <CollapsibleContent role="group" aria-label={label} className="p-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

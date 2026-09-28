import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

interface Props extends Omit<ComponentProps<typeof Button>, 'children' | 'asChild' | 'size' | 'variant'> {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tooltip?: ReactNode;
  selected?: boolean;
  compact?: boolean;
}

/** The app rail is icon-only; labels remain available to keyboards and assistive technology. */
export function AppSidebarButton({
  icon: Icon,
  label,
  tooltip = label,
  selected = false,
  compact = false,
  className,
  ...props
}: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={label}
          {...props}
          className={cn(
            'relative shrink-0 rounded-md px-0 font-normal text-muted-foreground hover:bg-hover-strong hover:text-foreground',
            'focus-visible:ring-inset focus-visible:ring-offset-0',
            compact ? 'size-9' : 'size-10',
            selected &&
              'bg-selected font-semibold text-selected-foreground hover:bg-selected hover:text-selected-foreground active:bg-selected',
            className,
          )}
        >
          <span aria-hidden="true">
            <Icon className={compact ? 'size-4' : 'size-5'} />
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

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

/** One owner for rail sizing, selected state, focus treatment and tooltips. */
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
            'relative flex-col gap-1 rounded-md px-0 font-normal text-muted-foreground',
            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong focus-visible:ring-offset-0',
            compact ? 'size-9' : 'h-14 w-14 text-[10px]',
            selected && 'bg-selected font-semibold text-selected-foreground hover:bg-selected active:bg-selected',
            className,
          )}
        >
          <span aria-hidden="true">
            <Icon className={compact ? 'size-4' : 'size-5'} />
          </span>
          {!compact && <span>{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

type Props = Omit<ComponentProps<typeof Button>, 'variant'> & {
  active?: boolean;
};

/** Shared sibling action for controls that float over an otherwise clickable media card. */
export function MediaOverlayActionButton({ active = false, className, size = 'xs', ...props }: Props) {
  return (
    <Button
      {...props}
      size={size}
      variant="outline"
      className={cn(
        'absolute top-2 right-2 z-20 max-w-[calc(100%-1rem)] border-border bg-overlay/95 text-foreground hover:bg-hover active:bg-pressed',
        active && 'border-selected-border bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
        className,
      )}
    />
  );
}

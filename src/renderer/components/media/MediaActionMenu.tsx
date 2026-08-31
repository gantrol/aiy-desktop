import type { ComponentProps } from 'react';
import { ActionMenuButton } from '@/renderer/components/ui/action-menu';
import { cn } from '@/renderer/lib/utils';

type Props = ComponentProps<typeof ActionMenuButton>;

export function MediaActionMenu({ className, contentClassName, side = 'top', align = 'end', ...props }: Props) {
  return (
    <ActionMenuButton
      {...props}
      side={side}
      align={align}
      variant="secondary"
      className={cn('size-8 bg-overlay/95 text-foreground shadow-overlay hover:bg-hover active:bg-pressed', className)}
      contentClassName={cn('w-52', contentClassName)}
    />
  );
}

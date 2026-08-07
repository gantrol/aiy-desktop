import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-surface-sunken px-1 font-mono text-2xs font-medium text-foreground-secondary tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="kbd-group" className={cn('inline-flex items-center gap-0.5', className)} {...props} />;
}

export { Kbd, KbdGroup };

import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

type MetaTextProps<E extends React.ElementType = 'span'> = {
  as?: E;
  mono?: boolean;
} & Omit<React.ComponentPropsWithoutRef<E>, 'as'>;

function MetaText<E extends React.ElementType = 'span'>({ as, mono = false, className, ...props }: MetaTextProps<E>) {
  const Comp = as ?? 'span';
  return (
    <Comp
      data-slot="meta-text"
      className={cn('text-xs text-muted-foreground tabular-nums', mono && 'font-mono', className)}
      {...props}
    />
  );
}

export { MetaText, type MetaTextProps };

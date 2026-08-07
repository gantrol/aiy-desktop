import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props extends ComponentProps<'section'> {
  expanded: boolean;
}

export function FullWindowComparison({ expanded, className, children, ...props }: Props) {
  return (
    <section
      data-full-window-comparison={expanded ? 'true' : 'false'}
      className={cn('flex min-h-0 flex-1 flex-col bg-background', expanded && 'size-full', className)}
      {...props}
    >
      {children}
    </section>
  );
}

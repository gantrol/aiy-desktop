import type { HTMLAttributes } from 'react';
import { cn } from '@/renderer/lib/utils';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-foreground/10', className)} {...props} />;
}

export { Skeleton };

import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props extends Omit<ComponentProps<'section'>, 'aria-label'> {
  accessibleName: string;
}

/** Shared, keyboard-reachable surface for page-level paste and drop intake. */
export function IntakeSurface({ accessibleName, className, tabIndex = 0, ...props }: Props) {
  return (
    <section
      data-slot="intake-surface"
      aria-label={accessibleName}
      tabIndex={tabIndex}
      className={cn(
        'relative outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}

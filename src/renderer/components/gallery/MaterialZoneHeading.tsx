import type { ComponentProps } from 'react';
import { Separator } from '@/renderer/components/ui/separator';
import { cn } from '@/renderer/lib/utils';

interface Props extends Omit<ComponentProps<'div'>, 'children'> {
  headingId: string;
  title: string;
}

export function MaterialZoneHeading({ headingId, title, className, ...props }: Props) {
  return (
    <div
      data-slot="material-zone-heading"
      className={cn('flex min-w-0 items-center gap-2 text-foreground-secondary', className)}
      {...props}
    >
      <Separator className="h-0.5 min-w-4 flex-1 bg-border-strong" />
      <h2 id={headingId} className="max-w-[70%] shrink-0 truncate text-xs font-semibold tracking-wide">
        {title}
      </h2>
      <Separator className="h-0.5 min-w-4 flex-1 bg-border-strong" />
    </div>
  );
}

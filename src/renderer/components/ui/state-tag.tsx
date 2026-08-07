import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/renderer/lib/utils';

const stateTagVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-foreground-secondary',
        locked: 'bg-state-locked-bg text-state-locked-fg',
        changed: 'bg-state-changed-bg text-state-changed-fg',
        success: 'bg-success-surface text-success',
        warning: 'bg-warning-surface text-warning',
        danger: 'bg-destructive-surface text-destructive',
        info: 'bg-info-surface text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

interface StateTagProps extends Omit<React.ComponentProps<'span'>, 'children'>, VariantProps<typeof stateTagVariants> {
  icon: React.ReactElement;
  children: React.ReactNode;
}

function StateTag({ tone, icon, children, className, ...props }: StateTagProps) {
  return (
    <span
      data-slot="state-tag"
      data-tone={tone ?? 'neutral'}
      className={cn(stateTagVariants({ tone }), className)}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

export { StateTag, stateTagVariants };

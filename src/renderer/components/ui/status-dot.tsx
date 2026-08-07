import * as React from 'react';
import { CircleAlertIcon, CircleIcon, XIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';

export type StatusDotVariant = 'pass' | 'partial' | 'fail' | 'unrated' | 'pending' | 'error';

const variantShapes: Record<StatusDotVariant, string> = {
  pass: 'solid',
  partial: 'half-ring',
  fail: 'cross',
  unrated: 'outline',
  pending: 'static-dot',
  error: 'alert',
};

const variantClasses: Record<StatusDotVariant, string> = {
  pass: 'text-verdict-pass',
  partial: 'text-verdict-partial',
  fail: 'text-verdict-fail',
  unrated: 'text-verdict-unrated',
  pending: 'text-muted-foreground',
  error: 'text-destructive',
};

function StatusGlyph({ variant }: { variant: StatusDotVariant }) {
  if (variant === 'pass') return <CircleIcon data-shape="solid" aria-hidden="true" className="size-3.5 fill-current" />;
  if (variant === 'partial')
    return (
      <svg
        data-shape="half-ring"
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5 fill-none stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M8 2a6 6 0 0 1 0 12" />
      </svg>
    );
  if (variant === 'fail') return <XIcon data-shape="cross" aria-hidden="true" className="size-3.5" strokeWidth={2.5} />;
  if (variant === 'unrated') return <CircleIcon data-shape="outline" aria-hidden="true" className="size-3.5" />;
  if (variant === 'pending')
    return <span data-shape="static-dot" aria-hidden="true" className="size-2 rounded-full bg-current" />;
  return <CircleAlertIcon data-shape="alert" aria-hidden="true" className="size-3.5" />;
}

interface StatusDotProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  variant: StatusDotVariant;
  label: string;
  labelVisibility?: 'visible' | 'sr-only';
}

function StatusDot({ variant, label, labelVisibility = 'sr-only', className, ...props }: StatusDotProps) {
  return (
    <span
      {...props}
      data-slot="status-dot"
      data-variant={variant}
      data-shape={variantShapes[variant]}
      className={cn('inline-flex shrink-0 items-center gap-1.5', variantClasses[variant], className)}
    >
      <StatusGlyph variant={variant} />
      <span className={cn('text-xs font-medium text-foreground', labelVisibility === 'sr-only' && 'sr-only')}>
        {label}
      </span>
    </span>
  );
}

export { StatusDot };

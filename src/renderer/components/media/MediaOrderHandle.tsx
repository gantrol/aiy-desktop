import { GripVerticalIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props extends ComponentProps<'button'> {
  label: string;
}

export function MediaOrderHandle({ label, className, children, title = label, type = 'button', ...props }: Props) {
  return (
    <button
      {...props}
      type={type}
      title={title}
      aria-label={props['aria-label'] ?? label}
      className={cn(
        'inline-flex h-6 min-w-6 cursor-grab items-center justify-center gap-0.5 rounded bg-overlay/90 px-1.5 text-2xs text-foreground active:cursor-grabbing disabled:cursor-default',
        className,
      )}
    >
      <GripVerticalIcon className="size-3 shrink-0" aria-hidden="true" />
      {children}
    </button>
  );
}

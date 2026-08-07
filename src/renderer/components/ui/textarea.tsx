import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

interface TextareaProps extends React.ComponentProps<'textarea'> {
  focusIndicator?: 'control' | 'container';
}

function Textarea({ className, focusIndicator = 'control', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-[color,background-color,border-color,box-shadow] duration-fast placeholder:text-muted-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-disabled-foreground disabled:opacity-100 disabled:placeholder:text-disabled-foreground',
        focusIndicator === 'control' &&
          'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

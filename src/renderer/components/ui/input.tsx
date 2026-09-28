import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

interface InputProps extends React.ComponentProps<'input'> {
  focusIndicator?: 'control' | 'container';
}

function Input({ className, type, focusIndicator = 'control', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm outline-none transition-[color,background-color,border-color,box-shadow] duration-fast placeholder:text-muted-foreground hover:border-muted-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-disabled-foreground disabled:opacity-100 disabled:placeholder:text-disabled-foreground',
        focusIndicator === 'control' &&
          'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}

export { Input };

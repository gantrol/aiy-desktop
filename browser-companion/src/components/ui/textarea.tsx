import type * as React from 'react';

import { cn } from '@/lib/cn';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-32 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

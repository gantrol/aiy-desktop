import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-input bg-background text-transparent outline-none transition-colors duration-fast hover:bg-hover active:bg-pressed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-selected-foreground data-[state=checked]:bg-selected-foreground data-[state=checked]:text-primary-foreground data-[state=checked]:hover:bg-selected-foreground data-[state=checked]:active:bg-selected-foreground disabled:pointer-events-none disabled:border-border disabled:bg-surface-sunken disabled:text-disabled-foreground disabled:opacity-100 disabled:data-[state=checked]:border-border disabled:data-[state=checked]:bg-surface-sunken disabled:data-[state=checked]:text-disabled-foreground',
        'data-[state=indeterminate]:border-selected-foreground data-[state=indeterminate]:bg-selected-foreground data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:hover:bg-selected-foreground data-[state=indeterminate]:active:bg-selected-foreground disabled:data-[state=indeterminate]:border-border disabled:data-[state=indeterminate]:bg-surface-sunken disabled:data-[state=indeterminate]:text-disabled-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group/indicator grid place-content-center">
        <CheckIcon className="size-3 group-data-[state=indeterminate]/indicator:hidden" />
        <MinusIcon className="hidden size-3 group-data-[state=indeterminate]/indicator:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/renderer/lib/utils';
import { lineTabClassName } from '@/renderer/components/ui/tab-styles';

const SegmentedAppearance = React.createContext<'default' | 'line'>('default');

function Segmented({
  appearance = 'default',
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  appearance?: 'default' | 'line';
}) {
  return (
    <SegmentedAppearance value={appearance}>
      <ToggleGroupPrimitive.Root
        data-density={appearance === 'line' ? 'compact' : undefined}
        className={cn(
          appearance === 'line'
            ? 'group/tabs inline-flex min-h-8 min-w-0 items-end border-b'
            : 'inline-flex h-8 items-center rounded-md bg-surface-sunken p-0.5',
          className,
        )}
        {...props}
      />
    </SegmentedAppearance>
  );
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const appearance = React.useContext(SegmentedAppearance);
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        appearance === 'line'
          ? lineTabClassName
          : 'inline-flex h-7 min-w-0 items-center justify-center rounded-sm border border-transparent px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-fast motion-reduce:transition-none hover:bg-hover-strong hover:text-foreground active:bg-pressed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=on]:border-border data-[state=on]:bg-surface data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:hover:bg-surface data-[state=on]:active:bg-surface disabled:pointer-events-none disabled:text-disabled-foreground disabled:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedItem };

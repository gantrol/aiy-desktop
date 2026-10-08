import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/renderer/lib/utils';
import { lineTabClassName } from '@/renderer/components/ui/tab-styles';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex min-h-0 flex-col', className)} {...props} />;
}

function TabsList({
  density = 'default',
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  density?: 'default' | 'compact';
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-density={density}
      className={cn('group/tabs flex min-h-9 min-w-0 items-end border-b data-[density=compact]:min-h-8', className)}
      {...props}
    />
  );
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} data-slot="tabs-trigger" className={cn(lineTabClassName, className)} {...props} />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };

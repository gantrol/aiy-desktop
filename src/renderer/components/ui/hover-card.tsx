import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { cn } from '@/renderer/lib/utils';
import { useOverlayPortalContainer } from '@/renderer/components/ui/overlay-layer';

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger(props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  const container = useOverlayPortalContainer();
  return (
    <HoverCardPrimitive.Portal container={container ?? undefined}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        data-overlay-layer="tooltip"
        data-overlay-surface=""
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'pointer-events-auto z-tooltip w-64 rounded-md border border-border bg-overlay p-4 text-foreground shadow-overlay outline-none',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };

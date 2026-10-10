import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Kbd } from '@/renderer/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export function CaptureToolButton({
  label,
  shortcut,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <TooltipProvider delayDuration={280}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={label} {...props}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {label}
          {shortcut && <Kbd className="ml-2">{shortcut}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

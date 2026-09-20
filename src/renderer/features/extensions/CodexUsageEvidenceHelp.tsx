import { InfoIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

export function CodexUsageEvidenceHelp({
  label,
  children,
  destructive = false,
}: {
  label: string;
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('size-6 shrink-0 text-muted-foreground', destructive && 'text-destructive')}
          aria-label={label}
        >
          <InfoIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(26rem,calc(100vw-2rem))] text-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

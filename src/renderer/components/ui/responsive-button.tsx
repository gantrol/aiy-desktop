import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

type Props = Omit<ComponentProps<typeof Button>, 'asChild'> & {
  label: string;
  responsive?: boolean;
  shortLabel?: string;
};

/** Uses the containing toolbar's width; touch users keep visible action names. */
export function ResponsiveButton({ label, shortLabel, responsive = true, children, className, ...props }: Props) {
  return (
    <TooltipProvider delayDuration={280}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-label={props['aria-label'] ?? label}
            className={cn(responsive && 'min-w-8 px-2 @min-[560px]:px-3', className)}
          >
            {children}
            <span className={responsive ? 'hidden @min-[560px]:inline [@media(pointer:coarse)]:inline' : undefined}>
              {label}
            </span>
            {responsive && shortLabel && (
              <span aria-hidden className="@min-[560px]:hidden [@media(pointer:coarse)]:hidden">
                {shortLabel}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

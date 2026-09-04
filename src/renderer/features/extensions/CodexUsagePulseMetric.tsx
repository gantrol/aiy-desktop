import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export function CodexUsagePulseMetric({
  icon,
  label,
  value,
  detail,
  note,
}: {
  icon: ReactNode;
  label: ReactNode;
  value: string;
  detail?: string;
  note?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 bg-background px-3 py-3">
      <dt className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
          {icon}
        </span>
        <span className="min-w-0">{label}</span>
        {note && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={note}
                className="-my-1 size-5 shrink-0 text-muted-foreground"
              >
                <InfoIcon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-pre-line">{note}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="truncate text-base font-semibold tabular-nums @xl/codex-usage:text-lg">{value}</dd>
      {detail && <dd className="hidden truncate text-[11px] text-muted-foreground @xl/codex-usage:block">{detail}</dd>}
    </div>
  );
}

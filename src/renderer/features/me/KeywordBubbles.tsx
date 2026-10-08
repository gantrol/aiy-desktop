import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { KeywordResult } from '@/shared/contracts/me';

export function KeywordBubbles({
  words,
  selected,
  onSelect,
}: {
  words: KeywordResult['words'];
  selected: string;
  onSelect(term: string): void;
}) {
  const copy = useI18n().messages.me;
  const max = Math.max(1, ...words.map((word) => word.count));
  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="flex min-h-72 flex-wrap content-center items-center justify-center gap-3 py-8"
        aria-label={copy.keywords}
      >
        {words.map((word) => {
          const size = Math.round(Math.max(52, 112 * Math.sqrt(word.count / max)));
          const current = selected === word.term;
          const counts = copy.counts(word.count, word.documents);
          return (
            <Tooltip key={word.term}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${word.term} · ${counts}`}
                  aria-pressed={current}
                  className={cn(
                    'shrink-0 flex-col gap-1 overflow-hidden rounded-full border border-border/60 bg-muted p-2 hover:bg-selected hover:text-selected-foreground focus-visible:bg-selected focus-visible:text-selected-foreground',
                    current && 'border-selected-foreground bg-selected text-selected-foreground',
                  )}
                  style={{ width: size, height: size }}
                  onClick={() => onSelect(current ? '' : word.term)}
                >
                  <span className="w-full truncate text-sm font-medium">{word.term}</span>
                  {size >= 84 && (
                    <span aria-hidden="true" className="text-xs tabular-nums">
                      {word.count}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>{word.term}</span>
                <span className="ml-2 tabular-nums">{counts}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

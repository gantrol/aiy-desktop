import { useState } from 'react';
import { ChevronDownIcon, HistoryIcon, PlusIcon } from 'lucide-react';
import type { HistoricalTermRecommendationRunDto, Locale } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { cn } from '@/renderer/lib/utils';

interface Props {
  locale: Locale;
  runs: HistoricalTermRecommendationRunDto[];
  selectedTermIds: string[];
  onAdd(termId: string): void;
}

const copy = {
  zh: {
    title: '历史推荐',
    prompts: '条 Prompt 已索引',
    add: '添加',
    added: '已添加',
    empty: '本次无候选',
    collapse: '折叠',
    expand: '展开',
  },
  en: {
    title: 'History suggestions',
    prompts: 'prompts indexed',
    add: 'Add',
    added: 'Added',
    empty: 'No candidates in this run',
    collapse: 'Collapse',
    expand: 'Expand',
  },
} as const;

function displayTitle(
  locale: Locale,
  item: { title: string; titleLocale: string; localizations: Array<{ locale: string; title: string }> },
) {
  if (item.titleLocale === locale) return item.title;
  return item.localizations.find((localization) => localization.locale === locale)?.title || item.title;
}

function RecommendationRun({
  run,
  locale,
  initiallyOpen,
  selectedTermIds,
  onAdd,
}: {
  run: HistoricalTermRecommendationRunDto;
  locale: Locale;
  initiallyOpen: boolean;
  selectedTermIds: string[];
  onAdd(termId: string): void;
}) {
  const labels = copy[locale];
  const [open, setOpen] = useState(initiallyOpen);
  const selected = new Set(selectedTermIds);
  const timestamp = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(run.createdAt));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-background">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
        <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {labels.title} · {timestamp}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {run.recommendations.length} · {run.indexedPromptCount} {labels.prompts}
        </span>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={open ? labels.collapse : labels.expand}>
            <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="grid gap-1.5 border-t bg-surface-sunken/20 p-2 sm:grid-cols-2">
          {run.recommendations.map((item) => {
            const added = selected.has(item.termId);
            return (
              <article
                key={`${run.id}:${item.termId}`}
                className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <strong className="truncate text-xs">{displayTitle(locale, item)}</strong>
                    {item.bases.includes('SIMILAR_PROMPT') && (
                      <Badge variant="secondary" className="h-4 shrink-0 rounded-sm px-1 text-[9px]">
                        Prompt
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-2xs leading-4 text-muted-foreground">{item.reason}</p>
                </div>
                <Button
                  type="button"
                  variant={added ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  disabled={added}
                  onClick={() => onAdd(item.termId)}
                >
                  {!added && <PlusIcon className="size-3" />}
                  {added ? labels.added : labels.add}
                </Button>
              </article>
            );
          })}
          {!run.recommendations.length && (
            <span className="px-1 py-2 text-xs text-muted-foreground">{labels.empty}</span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HistoricalTermRecommendations({ locale, runs, selectedTermIds, onAdd }: Props) {
  if (!runs.length) return null;
  return (
    <section className="grid max-h-56 gap-1.5 overflow-y-auto border-b bg-muted/30 p-2" aria-label={copy[locale].title}>
      {runs.map((run, index) => (
        <RecommendationRun
          key={run.id}
          run={run}
          locale={locale}
          initiallyOpen={index === 0}
          selectedTermIds={selectedTermIds}
          onAdd={onAdd}
        />
      ))}
    </section>
  );
}

export type { Props as HistoricalTermRecommendationsProps };

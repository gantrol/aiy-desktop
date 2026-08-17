import { HistoryIcon, InfoIcon, LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoDocumentGenerationRunDto } from '@/shared/contracts/video-document';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { VideoDocumentToolbarAction } from '@/renderer/features/video-documents/VideoDocumentToolbar';
import {
  formatApiEquivalentCostUsd,
  GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE,
  videoDocumentApiEquivalentCostUsd,
} from '@/renderer/features/video-documents/videoDocumentApiEquivalentCost';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  documentId: string;
  refreshKey: number;
  notify(message: string): void;
}

function tokenValue(value: number | null) {
  return value === null ? '' : value.toLocaleString();
}

function rateValue(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export function VideoDocumentGenerationHistory({ documentId, refreshKey, notify }: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.generation.history;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<VideoDocumentGenerationRunDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      if (loadingRef.current || (append && !nextCursorRef.current)) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await window.desktopApi.videoDocumentGenerationRunsList({
          documentId,
          cursor: append ? nextCursorRef.current : null,
          limit: 20,
        });
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        nextCursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [documentId, notify],
  );

  useEffect(() => {
    if (!open) return;
    void load(false);
  }, [documentId, load, open, refreshKey]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <VideoDocumentToolbarAction type="button" icon={<HistoryIcon className="size-4" />} label={labels.action} />
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="grid h-24 place-items-center text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>
          ) : (
            <TooltipProvider delayDuration={320}>
              <div className="divide-y rounded-lg border">
                {items.map((run) => {
                  const apiEquivalentCost = videoDocumentApiEquivalentCostUsd(run);
                  return (
                    <article key={run.id} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{labels.status[run.status]}</Badge>
                        <strong className="text-sm">{run.requestedModel}</strong>
                        <span className="text-xs text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        {run.errorCode && (
                          <code className="ml-auto text-xs text-muted-foreground">{run.errorCode}</code>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                        <span>
                          {labels.input}
                          <strong className="ml-1">{tokenValue(run.usage?.inputTokens ?? null)}</strong>
                        </span>
                        <span>
                          {labels.cached}
                          <strong className="ml-1">{tokenValue(run.usage?.cachedInputTokens ?? null)}</strong>
                        </span>
                        <span>
                          {labels.output}
                          <strong className="ml-1">{tokenValue(run.usage?.outputTokens ?? null)}</strong>
                        </span>
                        <span>
                          {labels.reasoning}
                          <strong className="ml-1">{tokenValue(run.usage?.reasoningOutputTokens ?? null)}</strong>
                        </span>
                        <span>
                          {labels.total}
                          <strong className="ml-1">{tokenValue(run.usage?.totalTokens ?? null)}</strong>
                        </span>
                        <span>
                          <span className="inline-flex items-center gap-1">
                            {labels.apiEquivalent}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={labels.apiEquivalentBasis}
                                >
                                  <InfoIcon className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-96 leading-5">
                                {labels.apiEquivalentInfo(
                                  GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE.modelId,
                                  rateValue(GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE.inputPerMillionUsd),
                                  rateValue(GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE.cachedInputPerMillionUsd),
                                  rateValue(GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE.outputPerMillionUsd),
                                  GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE.verifiedAt,
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                          <strong className="ml-1">
                            {apiEquivalentCost === null ? '' : formatApiEquivalentCostUsd(apiEquivalentCost)}
                          </strong>
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{labels.usage[run.usageAvailability]}</p>
                    </article>
                  );
                })}
              </div>
            </TooltipProvider>
          )}
          {nextCursor && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              disabled={loading}
              onClick={() => void load(true)}
            >
              {loading && <LoaderCircleIcon className="size-4 animate-spin" />}
              {labels.loadMore}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

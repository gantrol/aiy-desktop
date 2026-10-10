import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageSearchItem, ImageSearchResult, WorkspaceSearchMode } from '@/shared/contracts/image-search';
import type { ImageIssueResult } from '@/shared/contracts/image-search-issues';

function IssueDialog({
  channel,
  active,
  snapshot,
  onOpen,
}: {
  channel: 'visual' | 'ocr';
  active: boolean;
  snapshot: string;
  onOpen(item: ImageSearchItem): void;
}) {
  const { messages } = useI18n();
  const copy = messages.imageSearch;
  const lookup = messages.referenceOutline.lookup;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ImageIssueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = useRef<string | null>(null);
  const cancel = () => {
    if (current.current) void window.desktopApi?.imageSearch.cancel(current.current).catch(() => undefined);
    current.current = null;
  };
  const load = async (after = '', previous?: string) => {
    cancel();
    const id = crypto.randomUUID();
    current.current = id;
    setBusy(true);
    setError(false);
    try {
      const result = await window.desktopApi?.imageSearch.issues({ requestId: id, channel, after, snapshot: previous });
      if (current.current === id && result) setPage(result);
    } catch {
      if (current.current === id) setError(true);
    } finally {
      if (current.current === id) {
        current.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (open && active) void load();
    return cancel;
    // A changed result snapshot invalidates the current details page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, snapshot]);
  return (
    <Dialog open={open && active} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {copy.viewIssues}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="rounded-md">
        <DialogHeader>
          <DialogTitle>{channel === 'visual' ? copy.visualChannel : copy.ocrChannel}</DialogTitle>
        </DialogHeader>
        {error && <p role="alert">{copy.UNAVAILABLE}</p>}
        {busy && <p role="status">{lookup.searching}</p>}
        <ScrollArea className="h-[min(60vh,24rem)]" key={page?.snapshot + (page?.items[0]?.id ?? '')}>
          <ul className="divide-y">
            {page?.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.title || item.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.failure ? copy.issueReasons[item.failure.reason] : copy.limitedDetail}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    onOpen({
                      id: item.id,
                      title: item.title,
                      titleKind: 'NAME',
                      createdAt: '',
                      score: null,
                      match: 'EXACT',
                    });
                  }}
                >
                  {copy.open}
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
            {copy.refreshIssues}
          </Button>
          {page?.next && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void load(page.next!, page.snapshot)}>
              {lookup.loadMore}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImageSearchIssues({
  result,
  mode,
  active,
  onOpen,
  onRetry,
}: {
  result: ImageSearchResult | null;
  mode: WorkspaceSearchMode;
  active: boolean;
  onOpen(item: ImageSearchItem): void;
  onRetry(): void;
}) {
  const { messages, locale } = useI18n();
  const copy = messages.imageSearch;
  const number = new Intl.NumberFormat(locale);
  if (!result?.channels) return null;
  if (
    mode === 'HYBRID' &&
    ['DISABLED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'GPU_UNAVAILABLE'].includes(result.warning ?? '')
  )
    mode = 'TEXT';
  const channels = (['visual', 'ocr'] as const).filter(
    (channel) => mode === 'HYBRID' || (mode === 'TEXT' ? channel === 'ocr' : channel === 'visual'),
  );
  const issueChannels = channels.filter((channel) => {
    const coverage = result.channels![channel];
    return coverage.unavailable || coverage.deferred || coverage.limited;
  });
  if (!issueChannels.length) return null;
  return (
    <div className="border-t px-4 py-2 text-2xs text-warning">
      {issueChannels.length > 1 && (
        <p role="status">
          {copy.issueCount(number.format(result.affected ?? result.coverage.unavailable + result.coverage.limited))}
        </p>
      )}
      {issueChannels.map((channel) => {
        const coverage = result.channels![channel];
        const details = [
          ...coverage.reasons.map(({ reason, count }) => `${copy.issueReasons[reason]} ${number.format(count)}`),
          ...(coverage.limited > 0 ? [`${copy.limitedDetail} ${number.format(coverage.limited)}`] : []),
        ];
        return (
          <div key={channel} className="flex items-center gap-2">
            <span className="min-w-0 flex-1" role={issueChannels.length === 1 ? 'status' : undefined}>
              {channel === 'visual' ? copy.visualChannel : copy.ocrChannel} · {details.join(' · ')}
            </span>
            <IssueDialog
              channel={channel}
              active={active}
              snapshot={JSON.stringify([result.snapshot, coverage])}
              onOpen={onOpen}
            />
            {coverage.reasons.some(
              ({ reason }) => !['UNSUPPORTED_FORMAT', 'BYTE_LIMIT', 'PIXEL_LIMIT', 'DIMENSION_LIMIT'].includes(reason),
            ) && (
              <Button variant="ghost" size="sm" disabled={!active} onClick={onRetry}>
                {copy.retryIssues}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

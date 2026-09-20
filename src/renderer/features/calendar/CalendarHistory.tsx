import { useEffect, useRef, useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CalendarHistoryResult, CalendarItem } from '@/shared/contracts/calendar';
export function CalendarHistory({
  spaceId,
  item,
  timeZone,
  knownAt,
}: {
  spaceId: string;
  item: CalendarItem;
  timeZone: string;
  knownAt?: string;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const [history, setHistory] = useState<CalendarHistoryResult | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!showHistory) return;
    let cancelled = false;
    generation.current += 1;
    setHistory(null);
    setLoadingMore(false);
    setHistoryFailed(false);
    void window.desktopApi.calendar.history({ id: item.id, knownAt }, spaceId).then(
      (value) => {
        if (!cancelled) setHistory(value);
      },
      () => {
        if (!cancelled) setHistoryFailed(true);
      },
    );
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [showHistory, item.id, item.revision, spaceId, knownAt]);
  async function loadMore() {
    if (!history?.nextCursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    setHistoryFailed(false);
    try {
      const next = await window.desktopApi.calendar.history(
        {
          id: item.id,
          knownAt,
          cursor: history.nextCursor,
        },
        spaceId,
      );
      if (request !== generation.current) return;
      setHistory((current) => current && { ...next, revisions: [...current.revisions, ...next.revisions] });
    } catch {
      if (request === generation.current) setHistoryFailed(true);
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return (
    <div className="border-t border-border pt-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        aria-expanded={showHistory}
        onClick={() => setShowHistory(!showHistory)}
      >
        <HistoryIcon className="size-3.5" />
        {m.history}
      </Button>
      {showHistory && (
        <div className="mt-2 grid max-h-64 gap-3 overflow-y-auto pr-1">
          {historyFailed && (
            <p role="alert" className="text-xs text-destructive">
              {m.historyFailed}
            </p>
          )}
          {!history && !historyFailed && (
            <p role="status" className="text-xs text-muted-foreground">
              {m.loading}
            </p>
          )}
          {history?.revisions.length === 0 && <p className="text-xs text-muted-foreground">{m.noHistory}</p>}
          {history?.revisions.map((revision) => (
            <div key={revision.revision} className="border-l-2 border-border pl-3 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <strong className="font-medium">
                  {m.revision} {revision.revision}
                </strong>
                <time className="text-muted-foreground">{timestamp(revision.recordedAt)}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{revision.note}</p>
              {revision.displayDate && (
                <p className="mt-1 text-muted-foreground">
                  {m.happenedAt} · {revision.displayDate}
                </p>
              )}
              {revision.invalidated && <p className="mt-1 text-warning">{m.invalidated}</p>}
            </div>
          ))}
          {history?.hasMore && (
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? m.loading : m.historyLoadMore}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

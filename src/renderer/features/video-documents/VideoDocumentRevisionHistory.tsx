import { HistoryIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VideoDocumentRevisionDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { VideoDocumentToolbarAction } from '@/renderer/features/video-documents/VideoDocumentToolbar';
import { summarizeVideoDocumentRevisionDiff } from '@/renderer/features/video-documents/videoDocumentRevisionDiff';
import { useI18n } from '@/renderer/i18n/useI18n';

const HISTORY_PAGE_SIZE = 10;

interface Props {
  revision: VideoDocumentRevisionDto;
}

function revisionTimestamp(value: string, locale: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function VideoDocumentRevisionHistory({ revision }: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.videoDocuments.revisionHistory;
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<VideoDocumentRevisionDto[]>([revision]);
  const [nextRevisionId, setNextRevisionId] = useState<string | null>(revision.parentRevisionId);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestRef = useRef(0);

  async function loadPage(startRevisionId: string, request: number) {
    setLoading(true);
    setLoadFailed(false);
    try {
      const loaded: VideoDocumentRevisionDto[] = [];
      const loadedIds = new Set<string>();
      let cursor: string | null = startRevisionId;
      while (cursor && loaded.length < HISTORY_PAGE_SIZE) {
        const parent = await window.desktopApi.videoDocumentRevisionGet(revision.branchId, cursor);
        if (!parent || parent.branchId !== revision.branchId || loadedIds.has(parent.id)) {
          cursor = null;
          break;
        }
        loaded.push(parent);
        loadedIds.add(parent.id);
        cursor = parent.parentRevisionId;
      }
      if (requestRef.current !== request) return;
      setRevisions((current) => [...current, ...loaded.filter((item) => !current.some(({ id }) => id === item.id))]);
      setNextRevisionId(cursor);
    } catch {
      if (requestRef.current === request) setLoadFailed(true);
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }

  useEffect(() => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setRevisions([revision]);
    setNextRevisionId(revision.parentRevisionId);
    setLoadFailed(false);
    setLoading(false);
    if (open && revision.parentRevisionId) void loadPage(revision.parentRevisionId, request);
    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
    // The immutable revision id identifies the complete revision snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, revision.id]);

  const originLabels = {
    HUMAN: labels.origin.human,
    AGENT: labels.origin.agent,
    SYSTEM: labels.origin.system,
  } as const;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <VideoDocumentToolbarAction type="button" icon={<HistoryIcon className="size-4" />} label={labels.action} />
      </DialogTrigger>
      <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] max-w-xl grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1" aria-label={labels.title}>
          <ol className="grid gap-2">
            {revisions.map((item, index) => {
              const parent = revisions[index + 1];
              const diff = parent ? summarizeVideoDocumentRevisionDiff(parent.content, item.content) : null;
              const isInitial = !item.parentRevisionId;
              return (
                <li key={item.id} className="rounded-lg border bg-surface-subtle p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium tabular-nums">r{item.revisionNo}</span>
                    {index === 0 && <Badge variant="secondary">{labels.current}</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {revisionTimestamp(item.createdAt, locale)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{originLabels[item.origin]}</span>
                    {isInitial ? (
                      <span>{labels.initial}</span>
                    ) : diff ? (
                      diff.addedLines || diff.removedLines ? (
                        <span className="flex items-center gap-1.5 tabular-nums">
                          <span className="text-success">+{diff.addedLines}</span>
                          <span className="text-destructive">−{diff.removedLines}</span>
                          <span>{labels.lines}</span>
                        </span>
                      ) : (
                        <span>{labels.noTextChanges}</span>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {(nextRevisionId || loading || loadFailed) && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !nextRevisionId}
                onClick={() => {
                  if (!nextRevisionId) return;
                  const request = requestRef.current + 1;
                  requestRef.current = request;
                  void loadPage(nextRevisionId, request);
                }}
              >
                {loading && <LoaderCircleIcon className="size-4 animate-spin" />}
                {loading ? labels.loading : loadFailed ? labels.retry : labels.loadMore}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

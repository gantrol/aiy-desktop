import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, LoaderCircle } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { ContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useI18n } from '@/renderer/i18n/useI18n';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import type { ContentLinkUses } from '@/shared/contracts/content-links';

export function ContentBacklinksButton({
  spaceId,
  articleId,
  beforeOpen,
}: {
  spaceId: string;
  articleId: string;
  beforeOpen?(): Promise<boolean>;
}) {
  return (
    <ContentReferenceHost.Provider
      value={{
        source: { kind: 'ARTICLE', id: articleId },
        beforeCapture: beforeOpen
          ? async () => ((await beforeOpen()) ? { kind: 'ARTICLE', id: articleId } : null)
          : undefined,
      }}
    >
      <ContentBacklinksDialog spaceId={spaceId} articleId={articleId} />
    </ContentReferenceHost.Provider>
  );
}

function ContentBacklinksDialog({ spaceId, articleId }: { spaceId: string; articleId: string }) {
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false);
  const navigate = useReferenceNavigation(undefined, open);
  const [items, setItems] = useState<ContentLinkUses['items']>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cancelPending = useCallback(() => {
    generation.current++;
  }, []);
  const lastOffset = useRef(0);
  const load = async (offset: number) => {
    const request = ++generation.current;
    lastOffset.current = offset;
    setBusy(true);
    setError('');
    try {
      const result = await contentLibraryApi().linkUses(
        { spaceId, target: { kind: 'ARTICLE', id: articleId } },
        offset,
      );
      if (request !== generation.current) return;
      setItems((previous) => [
        ...new Map(
          [...(offset ? previous : []), ...result.items].map((item) => [
            JSON.stringify([item.source.id, item.blockId, item.preview]),
            item,
          ]),
        ).values(),
      ]);
      setUnavailable((previous) => (offset ? previous : 0) + result.unavailable);
      setNextOffset(result.nextOffset);
      setLoaded(true);
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    generation.current++;
    setItems([]);
    setNextOffset(null);
    setUnavailable(0);
    setLoaded(false);
    setError('');
    if (open) void load(0);
    return cancelPending;
    // Opening or changing the source owns a bounded, cancellable lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spaceId, articleId, cancelPending]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        generation.current++;
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" title={copy.linkBacklinks} aria-label={copy.linkBacklinks}>
          <Link2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[75vh] max-w-lg flex-col" aria-describedby={undefined}>
        <DialogTitle>{copy.linkBacklinks}</DialogTitle>
        <p className="text-xs text-muted-foreground">{copy.linkUsesScope}</p>
        <div className="min-h-0 overflow-y-auto" aria-busy={busy}>
          {items.map((item) => (
            <Button
              key={JSON.stringify([item.source.id, item.blockId, item.preview])}
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal text-left"
              disabled={busy}
              onClick={() => {
                const request = ++generation.current;
                setBusy(true);
                setError('');
                void navigate({
                  source: { ...item.source, revisionId: undefined },
                  ...(item.blockId ? { blockId: item.blockId } : {}),
                })
                  .then(
                    () => {
                      if (request === generation.current) setOpen(false);
                    },
                    (reason: unknown) => {
                      if (request === generation.current) setError(referenceFailure(reason, copy));
                    },
                  )
                  .finally(() => {
                    if (request === generation.current) setBusy(false);
                  });
              }}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{item.title || item.source.id}</span>
                <span className="text-xs text-muted-foreground">{item.preview}</span>
              </span>
            </Button>
          ))}
          {loaded && !busy && !items.length && !error && (
            <p role="status" className="py-3 text-sm text-muted-foreground">
              {nextOffset !== null || unavailable ? copy.linkNoUsesPage : copy.linkNoUses}
            </p>
          )}
        </div>
        {unavailable > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {copy.linkUsesPartial}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {busy && <LoaderCircle className="size-4 animate-spin" aria-label={copy.lookup.title} />}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(error ? lastOffset.current : 0)}>
            {error ? copy.retry : copy.refresh}
          </Button>
          {nextOffset !== null && !error && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(nextOffset)}>
              {copy.more}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

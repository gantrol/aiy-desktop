import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import type { ContentReference, ReferencePreview } from '@/shared/contracts/content-library';
import { ContentReferenceUses } from '@/renderer/features/content-editor/ContentReferenceUses';
import { isDocumentSource } from '@/shared/contracts/content-source';
import { useI18n } from '@/renderer/i18n/useI18n';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { contentLibraryApi, currentReferenceTarget } from '@/renderer/features/content-editor/ContentReferencePicker';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';

export function ContentReferenceSource({
  reference,
  originBlockId,
}: {
  reference: ContentReference;
  originBlockId?: string;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline,
    labels = messages.desktopPetals.document;
  const [open, setOpen] = useState(false);
  const navigate = useReferenceNavigation(originBlockId, open);
  const canOpenEditor = reference.source.kind === 'ARTICLE' || reference.source.kind === 'INSPIRATION_STASH';
  const [current, setCurrent] = useState<ReferencePreview | null>(null);
  const [showUses, setShowUses] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const cancelPending = useCallback(() => {
    epoch.current++;
  }, []);
  const target = currentReferenceTarget(
    reference.source,
    reference.selector?.kind === 'BLOCK' ? reference.selector.blockId : undefined,
    reference.selector?.kind === 'BLOCK' ? reference.selector.section : undefined,
    reference.selector?.kind === 'BLOCK' ? reference.selector.scope : undefined,
  );
  useEffect(() => {
    epoch.current++;
    setCurrent(null);
    setShowUses(false);
    setError('');
    setBusy(false);
    return cancelPending;
  }, [open, reference.id, cancelPending]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    const request = epoch.current;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      if (request === epoch.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  };
  const media = current?.media ?? reference.media;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" title={labels.source} aria-label={labels.source}>
          <FileText className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{reference.title || labels.source}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {current ? copy.current : copy.captured} · {current?.revisionId ?? reference.revisionId}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canOpenEditor && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigate(target);
                  setOpen(false);
                })
              }
            >
              {copy.openSource}
            </Button>
          )}
          {canOpenEditor && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigate(target, { beside: true });
                  setOpen(false);
                })
              }
            >
              {copy.editSourceBeside}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setCurrent(null);
              setError('');
            }}
          >
            {copy.captured}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const request = epoch.current;
                try {
                  const value = await contentLibraryApi().referenceInspect(target);
                  const expanded = await contentLibraryApi().render(value.markdown);
                  if (request === epoch.current) {
                    setCurrent({ ...value, markdown: expanded.markdown, media: [...value.media, ...expanded.media] });
                  }
                } catch {
                  if (request === epoch.current) {
                    setCurrent(null);
                    setError(copy.unavailable);
                  }
                }
              })
            }
          >
            {copy.current}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowUses((visible) => !visible)}>
            {copy.uses}
          </Button>
          {isDocumentSource(reference.source) && (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={labels.reveal}
              onClick={() =>
                void run(async () => {
                  if (isDocumentSource(reference.source)) await contentLibraryApi().reveal(reference.source);
                })
              }
            >
              <FolderOpen className="size-4" />
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="min-h-0 overflow-y-auto whitespace-normal text-sm leading-relaxed">
          <ContentReferenceBody
            originBlockId={originBlockId}
            onNavigated={() => setOpen(false)}
            markdown={current?.markdown ?? reference.markdown}
            media={media}
            source={
              current
                ? {
                    ...current.target.source,
                    ...(isDocumentSource(current.target.source) ? { revisionId: current.revisionId } : {}),
                  }
                : {
                    ...reference.source,
                    ...(isDocumentSource(reference.source) ? { revisionId: reference.revisionId } : {}),
                  }
            }
          />
          {showUses && (
            <section className="mt-4 border-t pt-3" aria-label={copy.uses}>
              <h3 className="text-sm font-medium">{copy.uses}</h3>
              <ContentReferenceUses target={target} originBlockId={originBlockId} onNavigated={() => setOpen(false)} />
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

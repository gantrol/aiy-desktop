import { CheckIcon, CornerDownRightIcon, GalleryVerticalEndIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

interface Props {
  rows: readonly { id: string; title: string; depth: number }[];
  target: { id: string; title: string; currentAlbumId: string | null } | null;
  labels: { title: string; topLevel: string; operationFailed: string };
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onMove(albumId: string | null): Promise<void>;
}

export function AlbumMoveDestinationDialog({ rows, target, labels, busy = false, onOpenChange, onMove }: Props) {
  const [pendingDestination, setPendingDestination] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const submitting = pendingDestination !== undefined;

  useEffect(() => {
    setPendingDestination(undefined);
    setError('');
  }, [target?.id]);

  async function choose(destinationAlbumId: string | null) {
    if (!target || busy || submitting || target.currentAlbumId === destinationAlbumId) return;
    setPendingDestination(destinationAlbumId);
    setError('');
    try {
      await onMove(destinationAlbumId);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : labels.operationFailed);
    } finally {
      setPendingDestination(undefined);
    }
  }

  function destinationRow(id: string | null, title: string, depth: number) {
    const current = target?.currentAlbumId === id;
    const pending = submitting && pendingDestination === id;
    return (
      <Button
        key={id ?? 'top-level'}
        type="button"
        variant={current ? 'secondary' : 'ghost'}
        disabled={busy || submitting || current}
        aria-current={current ? 'location' : undefined}
        className="h-10 w-full justify-start gap-2 rounded-none px-3 font-normal"
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={() => void choose(id)}
      >
        {depth > 0 && <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <GalleryVerticalEndIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left" title={title}>
          {title}
        </span>
        {pending ? (
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          current && <CheckIcon className="size-3.5 shrink-0" />
        )}
      </Button>
    );
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="max-w-sm gap-3">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription className="sr-only">{target?.title ?? labels.title}</DialogDescription>
        </DialogHeader>
        <ScrollArea
          type="always"
          className={cn(
            'max-h-80 rounded-lg border bg-background [&_[data-slot=scroll-area-viewport]>div]:!block',
            error && 'border-destructive/50',
          )}
        >
          <div className="divide-y">
            {destinationRow(null, labels.topLevel, 0)}
            {rows.map(({ id, title, depth }) => destinationRow(id, title, depth))}
          </div>
        </ScrollArea>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { CheckIcon, CornerDownRightIcon, GalleryVerticalEndIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { buildAlbumTreeIndex, flattenAlbumTree } from '@/renderer/components/albums/albumTree';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

export interface AlbumMoveTarget {
  kind: 'ALBUM' | 'CREATION';
  id: string;
  title: string;
  currentAlbumId: string | null;
}

interface Labels {
  title: string;
  topLevel: string;
  operationFailed: string;
}

interface Props {
  albums: readonly AlbumDto[];
  target: AlbumMoveTarget | null;
  labels: Labels;
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onMove(albumId: string | null): Promise<void>;
}

function blockedAlbumDestinations(target: AlbumMoveTarget | null, tree: ReturnType<typeof buildAlbumTreeIndex>) {
  const blocked = new Set<string>();
  if (target?.kind !== 'ALBUM') return blocked;
  const pending = [target.id];
  while (pending.length > 0) {
    const albumId = pending.pop();
    if (!albumId || blocked.has(albumId)) continue;
    blocked.add(albumId);
    for (const child of tree.childrenByParentId.get(albumId) ?? []) pending.push(child.id);
  }
  return blocked;
}

/** Shared, keyboard-accessible destination picker for both creator and material album trees. */
export function AlbumMoveDialog({ albums, target, labels, busy = false, onOpenChange, onMove }: Props) {
  const [pendingDestination, setPendingDestination] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const tree = useMemo(() => buildAlbumTreeIndex(albums), [albums]);
  const blocked = useMemo(() => blockedAlbumDestinations(target, tree), [target, tree]);
  const rows = useMemo(() => flattenAlbumTree(tree).filter(({ album }) => !blocked.has(album.id)), [blocked, tree]);
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

  function destinationRow(album: AlbumDto | null, depth: number) {
    const destinationId = album?.id ?? null;
    const current = target?.currentAlbumId === destinationId;
    const pending = submitting && pendingDestination === destinationId;
    const label = album?.title ?? labels.topLevel;
    return (
      <Button
        key={album?.id ?? 'top-level'}
        type="button"
        variant={current ? 'secondary' : 'ghost'}
        disabled={busy || submitting || current}
        aria-current={current ? 'location' : undefined}
        className="h-10 w-full justify-start gap-2 rounded-none px-3 font-normal"
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={() => void choose(destinationId)}
      >
        {depth > 0 && <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <GalleryVerticalEndIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left" title={label}>
          {label}
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
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!submitting) onOpenChange(open);
      }}
    >
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
            {destinationRow(null, 0)}
            {rows.map(({ album, depth }) => destinationRow(album, depth))}
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

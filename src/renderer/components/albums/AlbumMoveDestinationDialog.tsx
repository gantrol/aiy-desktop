import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { AlbumPickerPanel } from '@/renderer/components/albums/AlbumPickerPanel';
import { buildAlbumPickerIndex, type AlbumPickerOption } from '@/renderer/components/albums/albumPickerModel';

interface Props {
  rows: readonly AlbumPickerOption[];
  target: { id: string; title: string; currentAlbumId: string | null } | null;
  labels: { title: string; topLevel: string; operationFailed: string };
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onMove(albumId: string | null): Promise<void>;
}

export function AlbumMoveDestinationDialog({ rows, target, labels, busy = false, onOpenChange, onMove }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const currentAlbumId = target?.currentAlbumId;
  const index = useMemo(
    () =>
      buildAlbumPickerIndex(
        rows.map((row) => ({
          ...row,
          disabled: row.disabled || row.id === currentAlbumId,
        })),
      ),
    [rows, currentAlbumId],
  );

  useEffect(() => {
    setQuery('');
    setParentId(null);
    setError('');
  }, [target?.id]);

  async function choose(destinationAlbumId: string | null) {
    if (!target || busy || running.current || target.currentAlbumId === destinationAlbumId) return;
    if (
      destinationAlbumId !== null &&
      (!index.byId.has(destinationAlbumId) || index.byId.get(destinationAlbumId)?.disabled)
    )
      return;
    running.current = true;
    setSubmitting(true);
    setError('');
    try {
      await onMove(destinationAlbumId);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : labels.operationFailed);
    } finally {
      running.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !running.current && onOpenChange(open)}>
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden rounded-md p-0"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (running.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (running.current) event.preventDefault();
        }}
      >
        <DialogHeader className="px-3 py-4 pr-12">
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 max-h-[min(24rem,calc(100dvh-9rem))] flex-col">
          <AlbumPickerPanel
            index={index}
            value={target?.currentAlbumId ?? null}
            label={labels.title}
            nullOption={{ kind: 'root', label: labels.topLevel, disabled: currentAlbumId === null }}
            parentId={parentId}
            query={query}
            busy={busy || submitting}
            error={false}
            onQueryChange={setQuery}
            onNavigate={setParentId}
            onSelect={(id) => void choose(id)}
          />
        </div>
        {error && (
          <div role="alert" className="px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

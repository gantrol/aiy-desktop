import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import type { AlbumEditorState, AlbumNavigationLabels } from '@/renderer/components/gallery/AlbumNavigation';

export function AlbumEditorDialog({
  state,
  labels,
  busy,
  onOpenChange,
  onSubmit,
}: {
  state: AlbumEditorState | null;
  labels: AlbumNavigationLabels;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(title: string): Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const stateKey =
    state?.mode === 'rename'
      ? `${state.mode}:${state.album.id}`
      : state?.mode === 'create'
        ? `${state.mode}:${state.parent?.id ?? 'root'}`
        : '';
  const initialTitle = state?.mode === 'rename' ? state.album.title : '';
  useEffect(() => {
    setTitle(initialTitle);
    setError('');
  }, [stateKey, initialTitle]);

  function openChanged(open: boolean) {
    if (!open && !submitting) {
      setTitle('');
      setError('');
      onOpenChange(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || busy || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(nextTitle);
      setTitle('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.operationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog key={stateKey} open={Boolean(state)} onOpenChange={openChanged}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {state?.mode === 'rename'
                ? labels.renameTitle
                : state?.mode === 'create' && state.parent
                  ? labels.createChild
                  : labels.createTitle}
            </DialogTitle>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            {labels.name}
            <Input
              autoFocus
              value={title}
              maxLength={120}
              disabled={busy || submitting}
              placeholder={labels.namePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy || submitting} onClick={() => openChanged(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={busy || submitting || !title.trim()}>
              {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
              {state?.mode === 'rename' ? labels.save : labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteAlbumDialog({
  album,
  labels,
  busy,
  onOpenChange,
  onDelete,
}: {
  album: AlbumDto | null;
  labels: AlbumNavigationLabels;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (!album || busy || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onDelete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.operationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(album)}
      onOpenChange={(open) => {
        if (!open && !submitting) {
          setError('');
          onOpenChange(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.deleteTitle}</DialogTitle>
          <DialogDescription>{album ? labels.deleteDescription(album.title) : ''}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy || submitting} onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={busy || submitting} onClick={() => void confirm()}>
            {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
            {labels.confirmDelete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';

export interface CreateAlbumDialogLabels {
  title: string;
  childTitle: string;
  name: string;
  placeholder: string;
  cancel: string;
  create: string;
  operationFailed: string;
}

interface Props {
  open: boolean;
  parentTitle?: string | null;
  busy?: boolean;
  labels: CreateAlbumDialogLabels;
  onOpenChange(open: boolean): void;
  onCreate(title: string): Promise<void>;
}

export function CreateAlbumDialog({ open, parentTitle, busy = false, labels, onOpenChange, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setTitle('');
      setError('');
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || busy || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onCreate(nextTitle);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : labels.operationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{parentTitle ? `${labels.childTitle} · ${parentTitle}` : labels.title}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            {labels.name}
            <Input
              autoFocus
              value={title}
              maxLength={120}
              disabled={busy || submitting}
              placeholder={labels.placeholder}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy || submitting} onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={busy || submitting || !title.trim()}>
              {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
              {labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

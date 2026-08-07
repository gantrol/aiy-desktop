import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';

interface Props {
  album: AlbumDto | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(album: AlbumDto, title: string): Promise<void>;
}

export function RenameAlbumDialog({ album, open, onOpenChange, onSave }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.album;
  const common = messages.common;
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !album) return;
    setTitle(album.title);
    setError('');
    setBusy(false);
  }, [album, open]);

  async function save() {
    const nextTitle = title.trim();
    if (!album || !nextTitle || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(album, nextTitle);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{labels.renameAlbumTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="album-name">{labels.albumName}</Label>
          <Input
            id="album-name"
            autoFocus
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {common.cancel}
          </Button>
          <Button type="button" disabled={busy || !title.trim()} onClick={() => void save()}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {messages.creator.rename.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

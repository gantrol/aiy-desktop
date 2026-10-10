import { useEffect, useState } from 'react';
import { Eye, MonitorUp, Pencil, Save, MoreHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { CaptureToolButton } from '@/renderer/features/clipboard-capture/CaptureToolButton';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

export function CaptureHistoryActions({
  controller,
  title,
}: {
  controller: ClipboardHistoryController;
  title: string;
}) {
  const l = useI18n().messages.clipboardCapture;
  const { selected: entry, busy, run, execute, errorText } = controller;
  const [dialog, setDialog] = useState<'preview' | 'rename' | 'remove' | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const id = entry?.id;
  useEffect(() => {
    if (dialog !== 'preview' || !id) return;
    let current = true;
    setImage(null);
    setError('');
    void execute({ kind: 'read', id })
      .then((result) => {
        if (!current) return;
        if (result.kind === 'detail') setImage(result.image);
        else if (result.kind === 'error') setError(errorText(result.code));
      })
      .catch(() => {
        if (current) setError(l.errors.storage);
      });
    return () => {
      current = false;
    };
  }, [dialog, id, execute, errorText, l.errors.storage]);
  if (!entry) return null;
  const change = async () => {
    const ok = await run(
      dialog === 'rename' ? { kind: 'rename', id: entry.id, title: name } : { kind: 'remove', id: entry.id },
    );
    if (ok) setDialog(null);
  };
  return (
    <>
      <div className="flex items-center gap-1" aria-label={title}>
        <Button size="sm" disabled={busy} onClick={() => void run({ kind: 'copy', id: entry.id })}>
          {l.copy}
        </Button>
        <CaptureToolButton
          label={l.selection.pin}
          disabled={busy}
          onClick={() => void run({ kind: 'open', id: entry.id })}
        >
          <MonitorUp />
        </CaptureToolButton>
        <CaptureToolButton
          label={l.editImage}
          disabled={busy}
          onClick={() => void run({ kind: 'editImage', id: entry.id })}
        >
          <Pencil />
        </CaptureToolButton>
        <CaptureToolButton label={l.export} disabled={busy} onClick={() => void run({ kind: 'export', id: entry.id })}>
          <Save />
        </CaptureToolButton>
        <CaptureToolButton label={l.preview} disabled={busy} onClick={() => setDialog('preview')}>
          <Eye />
        </CaptureToolButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={l.selection.more} disabled={busy}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void run({ kind: 'pin', id: entry.id, pinned: !entry.pinned })}>
              {entry.pinned ? l.unpin : l.pin}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setName(title);
                setDialog('rename');
              }}
            >
              {l.rename}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('remove')}>{l.remove}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className={dialog === 'preview' ? 'max-w-[min(90vw,70rem)]' : undefined}
        >
          <DialogHeader>
            <DialogTitle>{dialog === 'preview' ? title : dialog === 'rename' ? l.rename : l.confirmRemove}</DialogTitle>
          </DialogHeader>
          {dialog === 'preview' && image && (
            <img src={image} alt={title} className="max-h-[75vh] w-full object-contain" />
          )}
          {dialog === 'rename' && (
            <Input
              autoFocus
              aria-label={l.rename}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          {(error || controller.error) && (
            <span role="alert" className="text-sm text-destructive">
              {error || controller.error}
            </span>
          )}
          {dialog !== 'preview' && (
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => setDialog(null)}>
                {l.cancel}
              </Button>
              <Button disabled={busy} onClick={() => void change()}>
                {dialog === 'rename' ? l.apply : l.remove}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

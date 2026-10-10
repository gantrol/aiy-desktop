import { useEffect, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardEntry } from '@/shared/contracts/clipboard-capture';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

export function ClipboardEntryDetails({
  entry,
  spaceId,
  controller,
}: {
  entry: ClipboardEntry;
  spaceId: string;
  controller: ClipboardHistoryController;
}) {
  const l = useI18n().messages.clipboardCapture;
  const { status, busy, run, errorText } = controller;
  const [detail, setDetail] = useState<{ text: string; image: string | null } | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const id = entry.id;
  useEffect(() => {
    let current = true;
    setError('');
    void window.desktopApi.clipboardCapture
      .execute({ kind: 'read', id })
      .then((result) => {
        if (!current) return;
        if (result.kind === 'detail') setDetail(result);
        else if (result.kind === 'error') {
          setDetail(null);
          setError(errorText(result.code));
        }
      })
      .catch(() => {
        if (current) {
          setDetail(null);
          setError(l.errors.storage);
        }
      });
    return () => {
      current = false;
    };
  }, [id, revision, errorText, l.errors.storage]);
  const unavailable = busy || !detail || Boolean(error);
  const copyUnavailable = unavailable || !status?.supported;
  const pasteUnavailable = copyUnavailable || !status?.enabled;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={copyUnavailable} onClick={() => void run({ kind: 'copy', id })}>
          {entry.kind === 'reference' ? l.copyReference : l.copy}
        </Button>
        {entry.kind !== 'image' && (
          <Button variant="outline" disabled={copyUnavailable} onClick={() => void run({ kind: 'copyPlain', id })}>
            {l.copyPlain}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pasteUnavailable}
          onClick={() => void run({ kind: 'paste', id, plain: false })}
        >
          {l.paste}
        </Button>
        {entry.kind !== 'image' && (
          <Button
            variant="ghost"
            disabled={pasteUnavailable}
            onClick={() => void run({ kind: 'paste', id, plain: true })}
          >
            {l.pastePlain}
          </Button>
        )}
        {entry.kind === 'image' ? (
          <Button variant="outline" disabled={unavailable} onClick={() => void run({ kind: 'editImage', id })}>
            {l.editImage}
          </Button>
        ) : (
          <Button variant="outline" disabled={unavailable} onClick={() => setEditing(detail?.text ?? '')}>
            {l.editText}
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void run({ kind: 'pin', id, pinned: !entry.pinned })}>
          {entry.pinned ? l.unpin : l.pin}
        </Button>
        <Button
          variant="outline"
          disabled={unavailable || entry.kind === 'reference'}
          onClick={() => void run({ kind: 'open', id })}
        >
          {l.open}
        </Button>
        <Button
          variant="outline"
          disabled={unavailable || !status?.canImport || entry.kind === 'reference'}
          onClick={() => void run({ kind: 'material', id, spaceId })}
        >
          {l.material}
        </Button>
        <Button variant="ghost" disabled={unavailable} onClick={() => void run({ kind: 'export', id })}>
          {l.export}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>
          {l.remove}
        </Button>
      </div>
      {error && (
        <div>
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="ghost" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            {l.refresh}
          </Button>
        </div>
      )}
      {entry.kind === 'reference' && <p className="text-sm text-muted-foreground">{l.reference}</p>}
      {detail?.image && (
        <img
          className="max-h-96 max-w-full self-start object-contain"
          src={detail.image}
          alt={l.imageAlt}
          onError={() => setError(l.imageFailed)}
        />
      )}
      {detail?.text && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{detail.text}</pre>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{l.editText}</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={l.text}
            value={editing ?? ''}
            maxLength={262144}
            rows={12}
            disabled={busy}
            onChange={(event) => setEditing(event.target.value)}
          />
          {controller.error && (
            <div role="alert" className="text-sm text-destructive">
              {controller.error}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              {l.cancel}
            </Button>
            <Button
              disabled={busy || !editing?.trim()}
              onClick={() => {
                if (editing !== null)
                  void run({ kind: 'saveText', text: editing }).then((saved) => {
                    if (saved) setEditing(null);
                  });
              }}
            >
              {l.saveCopy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{l.confirmRemove}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>
              {l.cancel}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run({ kind: 'remove', id })}>
              {l.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

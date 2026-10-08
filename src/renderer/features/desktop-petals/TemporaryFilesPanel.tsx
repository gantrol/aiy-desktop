import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, ClipboardPaste, X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import type { TemporaryFilesCommand, TemporaryFilesSnapshot } from '@/shared/contracts/temporary-files';

export function TemporaryFilesPanel({ settings = false }: { settings?: boolean }) {
  const copy = useI18n().messages.desktopPetals;
  const labels = copy.temporary;
  const [snapshot, setSnapshot] = useState<TemporaryFilesSnapshot | null>(null);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<string | null>(null);
  const [count, setCount] = useState(100);
  const running = useRef(false);
  const alive = useRef(false);
  const receive = useCallback((value: TemporaryFilesSnapshot) => {
    if (!alive.current) return;
    setSnapshot(value);
    setLimit((previous) => previous || String(value.limitBytes / 1024 / 1024));
  }, []);
  useEffect(() => {
    alive.current = true;
    const refresh = () =>
      void window.desktopPetals
        .temporaryFiles({ kind: 'list' })
        .then(receive)
        .catch((reason) => {
          if (alive.current) setError(reason);
        });
    refresh();
    const unsubscribe = window.desktopPetals.onChanged(refresh);
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [receive]);
  const run = async (command: TemporaryFilesCommand) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      receive(await window.desktopPetals.temporaryFiles(command));
    } catch (reason) {
      if (alive.current) setError(reason);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label={labels.title} aria-busy={busy}>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run({ kind: 'create', requestId: crypto.randomUUID() })}
        >
          <FilePlus2 />
          {labels.newNote}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void run({ kind: 'import', requestId: crypto.randomUUID() })}
        >
          <FolderOpen />
          {labels.import}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void run({ kind: 'clipboard', requestId: crypto.randomUUID() })}
        >
          <ClipboardPaste />
          {labels.clipboard}
        </Button>
      </div>
      {snapshot && (
        <div className="text-xs text-muted-foreground" role="status">
          {labels.used} {Math.ceil(snapshot.usedBytes / 1024 / 1024)} / {snapshot.limitBytes / 1024 / 1024} MiB
        </div>
      )}
      {settings && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="temporary-capacity">{labels.limit}</Label>
            <Input
              id="temporary-capacity"
              type="number"
              className="w-32"
              min={16}
              max={16384}
              value={limit}
              disabled={busy}
              onChange={(event) => setLimit(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy || !Number.isInteger(Number(limit)) || Number(limit) < 16 || Number(limit) > 16384}
            onClick={() => void run({ kind: 'configure', limitMiB: Number(limit) })}
          >
            {labels.save}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run({ kind: 'cleanup' })}>
            {labels.cleanup}
          </Button>
        </div>
      )}
      {Boolean(error) && (
        <div className="text-sm text-destructive" role="alert">
          {petalErrorText(error, copy.errors)}
        </div>
      )}
      <div className="min-h-0 max-h-96 flex-1 overflow-y-auto" role="list" aria-label={labels.title}>
        {snapshot?.items.slice(0, count).map((item) => (
          <div key={item.id} role="listitem" className="flex items-center gap-2 border-b border-dashed py-1">
            <Button
              variant="ghost"
              className="min-w-0 flex-1 justify-start font-normal"
              disabled={busy}
              onClick={() => void run({ kind: 'open', id: item.id })}
            >
              <span className="truncate">{item.title || copy.contentEntry.untitled}</span>
            </Button>
            {item.protected && <span className="shrink-0 text-xs text-muted-foreground">{labels.protected}</span>}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title={labels.discard}
              aria-label={labels.discard}
              onClick={() => setDiscard(item.id)}
            >
              <X />
            </Button>
          </div>
        ))}
        {snapshot?.items.length === 0 && (
          <div role="status" className="py-6 text-center text-sm text-muted-foreground">
            {labels.empty}
          </div>
        )}
        {snapshot && snapshot.items.length > count && (
          <Button variant="ghost" onClick={() => setCount((value) => value + 100)}>
            {copy.contentEntry.more}
          </Button>
        )}
      </div>
      <Dialog
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <DialogContent role="alertdialog" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{labels.discardConfirm}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscard(null)}>
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (discard) void run({ kind: 'discard', id: discard });
                setDiscard(null);
              }}
            >
              {labels.discard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

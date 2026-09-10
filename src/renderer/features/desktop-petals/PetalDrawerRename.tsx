import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function PetalDrawerRename({
  name,
  close,
  onError,
}: {
  name: string;
  close(): Promise<void>;
  onError(error: unknown): void;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals;
  const [value, setValue] = useState(name),
    [busy, setBusy] = useState(false);
  const save = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await window.desktopPetals.drawer({ kind: 'rename', name: value });
      await close();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void close().catch(onError);
      }}
    >
      <DialogContent
        className="w-72 max-w-[calc(100vw-32px)] gap-3 rounded-md p-4 shadow-none"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{copy.drawer.rename}</DialogTitle>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            aria-label={copy.drawer.name}
            value={value}
            maxLength={40}
            disabled={busy}
            className="min-w-0 h-8"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || !value.trim()}>
            {copy.board.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

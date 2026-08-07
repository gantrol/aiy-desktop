import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(): Promise<void>;
  notify(message: string): void;
}

export function ContentPackImportDialog({ open, onOpenChange, onImported, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.intake.contentPack;
  const [pending, setPending] = useState(false);

  async function importContentPack() {
    if (pending) return;
    setPending(true);
    try {
      const result = await window.desktopApi.packImportLocal();
      if (result.status === 'cancelled') return;
      await onImported();
      onOpenChange(false);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{l.title}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {l.cancel}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void importContentPack()}>
            {l.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

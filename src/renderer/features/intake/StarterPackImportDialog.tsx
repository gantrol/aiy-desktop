import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(): Promise<void>;
  notify(message: string): void;
}

export function StarterPackImportDialog({ open, onOpenChange, onImported, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.intake.starterPack;
  const [pending, setPending] = useState(false);

  async function importStarterPack() {
    if (pending) return;
    setPending(true);
    try {
      await window.desktopApi.packImportStarter();
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
          <DialogDescription>{l.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-action="starter-pack-keep-empty"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {l.keepEmpty}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void importStarterPack()}>
            {l.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

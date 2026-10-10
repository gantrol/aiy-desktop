import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

export function ClearCaptureHistory({ controller }: { controller: ClipboardHistoryController }) {
  const l = useI18n().messages.clipboardCapture;
  const [open, setOpen] = useState(false);
  const [includePinned, setIncludePinned] = useState(false);
  return (
    <>
      <Button variant="ghost" disabled={controller.busy || !controller.status?.count} onClick={() => setOpen(true)}>
        {l.clearHistory}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!controller.busy) setOpen(value);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{l.confirmClear}</DialogTitle>
          </DialogHeader>
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={includePinned}
              disabled={controller.busy}
              onCheckedChange={(value) => setIncludePinned(value === true)}
            />
            {l.includePinned}
          </Label>
          {controller.error && (
            <span role="alert" className="text-sm text-destructive">
              {controller.error}
            </span>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={controller.busy} onClick={() => setOpen(false)}>
              {l.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={controller.busy}
              onClick={() => {
                void controller.run({ kind: 'clearHistory', includePinned }).then((done) => {
                  if (done) setOpen(false);
                });
              }}
            >
              {l.clearHistory}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

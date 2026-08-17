import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { LocalSpaceTransferProgressEvent } from '@/shared/contracts/local-space';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';

export type LocalSpaceTransferOperation = 'EXPORT' | 'IMPORT';

interface Props {
  open: boolean;
  requestId: number;
  operation: LocalSpaceTransferOperation;
  onOpenChange(open: boolean): void;
  onSwitched(): void;
  notify(message: string): void;
}

export function LocalSpaceTransferDialog({ open, requestId, operation, onOpenChange, onSwitched, notify }: Props) {
  const { messages } = useI18n();
  const copy = messages.space.transfer;
  const startedRequest = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<LocalSpaceTransferProgressEvent | null>(null);

  useEffect(() => {
    if (!open) return;
    return window.desktopApi.onLocalSpaceTransferProgress((event) => {
      if (event.operation === operation) setProgress(event);
    });
  }, [open, operation]);

  useEffect(() => {
    if (!open || startedRequest.current === requestId) return;
    startedRequest.current = requestId;
    setPending(true);
    setCancelling(false);
    setProgress(null);
    const request =
      operation === 'EXPORT'
        ? window.desktopApi.localSpacesExportCurrent()
        : window.desktopApi.localSpacesImportArchive();
    void request
      .then((result) => {
        if (result.status === 'failed') notify(copy.errors[result.errorCode]);
        if (result.status === 'exported') notify(copy.exported);
        if (result.status === 'switched') onSwitched();
        if (result.status !== 'switched') onOpenChange(false);
      })
      .catch(() => notify(copy.errors[operation === 'EXPORT' ? 'WRITE_FAILED' : 'ARCHIVE_INVALID']))
      .finally(() => {
        setPending(false);
        setCancelling(false);
        setProgress(null);
      });
  }, [copy, notify, onOpenChange, onSwitched, open, operation, requestId]);

  async function cancel() {
    if (!pending) {
      onOpenChange(false);
      return;
    }
    if (cancelling) return;
    setCancelling(true);
    await window.desktopApi.localSpacesCancelTransfer().catch(() => undefined);
  }

  const progressValue = progress?.progress ?? 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{operation === 'EXPORT' ? copy.exportTitle : copy.importTitle}</DialogTitle>
          <DialogDescription>
            {operation === 'EXPORT' ? copy.exportDescription : copy.importDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {progress ? copy.stages[progress.stage] : copy.stages.PREPARING}
          </div>
          <div
            role="progressbar"
            aria-label={copy.progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-base"
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <p className="text-right text-xs tabular-nums text-muted-foreground">{progressValue}%</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={cancelling} onClick={() => void cancel()}>
            {copy.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

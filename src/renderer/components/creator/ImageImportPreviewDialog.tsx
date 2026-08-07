import { CheckIcon, CopyIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import type { RendererImageImportPreviewRow } from '@/renderer/components/creator/imageImport';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';

interface Props {
  open: boolean;
  rows: RendererImageImportPreviewRow[] | null;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

export function ImageImportPreviewDialog({ open, rows, busy, onOpenChange, onConfirm }: Props) {
  const l = useI18n().messages.creator.workbench;
  const ready = rows?.filter((row) => row.state === 'READY').length ?? 0;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{l.reviewImport}</DialogTitle>
        </DialogHeader>
        <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {!rows && (
            <div className="grid h-20 place-items-center">
              <LoaderCircleIcon className="size-4 animate-spin" />
            </div>
          )}
          {rows?.map((row) => (
            <div key={row.item.id} className="flex min-h-10 items-center gap-2 px-3 text-xs">
              {row.state === 'READY' ? (
                <CheckIcon className="size-4 text-success" />
              ) : row.state === 'DUPLICATE' ? (
                <CopyIcon className="size-4 text-muted-foreground" />
              ) : (
                <XIcon className="size-4 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate">{row.item.name}</span>
              <span className="text-muted-foreground">
                {row.state === 'READY' ? l.ready : row.state === 'DUPLICATE' ? l.duplicates : l.invalid}
              </span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {l.cancel}
          </Button>
          <Button type="button" disabled={busy || !ready} onClick={onConfirm}>
            {l.importResults} · {ready}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

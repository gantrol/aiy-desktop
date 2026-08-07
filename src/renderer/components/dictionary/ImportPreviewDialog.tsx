import type { ImportPreview } from '@/shared/contracts';
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
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

interface Props {
  preview: ImportPreview | null;
  busy: boolean;
  onClose(): void;
  onCommit(): void;
}

export function ImportPreviewDialog({ preview, busy, onClose, onCommit }: Props) {
  const { messages } = useI18n();
  const l = messages.dictionary.importPreview;
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-dialog="dictionary-import-preview"
        data-operation-state={busy ? 'pending' : 'ready'}
        aria-busy={busy}
      >
        <DialogHeader>
          <DialogTitle>{l.title}</DialogTitle>
          <DialogDescription>
            {preview?.fileName} · {l.description}
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <span
                data-import-count="valid"
                className="flex flex-col rounded-lg border p-3 text-xs text-muted-foreground"
              >
                <b className="text-lg text-foreground">{preview.valid}</b>
                {l.valid}
              </span>
              <span
                data-import-count="duplicate"
                className="flex flex-col rounded-lg border p-3 text-xs text-muted-foreground"
              >
                <b className="text-lg text-foreground">{preview.duplicate}</b>
                {l.duplicate}
              </span>
              <span
                data-import-count="invalid"
                className="flex flex-col rounded-lg border p-3 text-xs text-muted-foreground"
              >
                <b className="text-lg text-foreground">{preview.invalid}</b>
                {l.invalid}
              </span>
            </div>
            <ScrollArea type="always" className="h-56 border-y">
              {preview.samples.map((row, index) => (
                <div className="flex justify-between border-b px-1 py-2" key={`${row.title}-${index}`}>
                  <strong>{row.title}</strong>
                  <small className="text-muted-foreground">
                    {row.titleLocale} · {row.state}
                  </small>
                </div>
              ))}
            </ScrollArea>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {l.cancel}
          </Button>
          <Button
            data-action="dictionary-import-commit"
            aria-busy={busy}
            disabled={!preview?.valid || busy}
            onClick={onCommit}
          >
            {l.commit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

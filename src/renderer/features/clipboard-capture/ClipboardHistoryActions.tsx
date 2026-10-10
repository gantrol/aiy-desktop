import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

export function ClipboardHistoryActions({
  controller,
  checked,
  onChecked,
  selectionMode = true,
}: {
  controller: ClipboardHistoryController;
  checked: string[];
  selectionMode?: boolean;
  onChecked(ids: string[]): void;
}) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const { status, busy, run } = controller;
  const [confirm, setConfirm] = useState<'clearHistory' | 'removeMany' | null>(null);
  const [includePinned, setIncludePinned] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {selectionMode && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !controller.items.length}
            onClick={() =>
              onChecked(
                controller.items.every((item) => checked.includes(item.id))
                  ? []
                  : controller.items.map((item) => item.id),
              )
            }
          >
            {l.selectPage}
          </Button>
        )}
        {checked.length > 0 && (
          <>
            <span className="text-xs">{checked.length.toLocaleString(locale)}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || checked.length > 50 || !status?.supported || !status.enabled}
              onClick={() =>
                void run({ kind: 'pasteQueue', ids: checked }).then((saved) => {
                  if (saved) onChecked([]);
                })
              }
            >
              {l.queuePaste}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                checked.length < 2 ||
                checked.length > 50 ||
                checked.some((id) => controller.items.find((item) => item.id === id)?.kind !== 'text')
              }
              onClick={() =>
                void run({ kind: 'combine', ids: checked, separator: '\n' }).then((saved) => {
                  if (saved) onChecked([]);
                })
              }
            >
              {l.combine}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('removeMany')}>
              {l.deleteSelected}
            </Button>
          </>
        )}
        {Boolean(status?.queuedCount) && (
          <>
            <span role="status" className="text-xs">
              {l.queued.replace('{count}', status!.queuedCount.toLocaleString(locale))}
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ kind: 'pasteNext' })}>
              {l.pasteNext}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ kind: 'cancelPasteQueue' })}>
              {l.cancelQueue}
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={messages.desktopPetals.imageEditor.more}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setConfirm('clearHistory')}>{l.clearHistory}</DropdownMenuItem>
            <DropdownMenuItem disabled={!status?.supported} onSelect={() => void run({ kind: 'clearClipboard' })}>
              {l.clearClipboard}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{confirm === 'clearHistory' ? l.confirmClear : l.confirmMany}</DialogTitle>
          </DialogHeader>
          {confirm === 'clearHistory' && (
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={includePinned}
                disabled={busy}
                onCheckedChange={(value) => setIncludePinned(value === true)}
              />
              {l.includePinned}
            </Label>
          )}
          {controller.error && (
            <div role="alert" className="text-sm text-destructive">
              {controller.error}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              {l.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!confirm) return;
                void run(
                  confirm === 'clearHistory' ? { kind: confirm, includePinned } : { kind: confirm, ids: checked },
                ).then((done) => {
                  if (done) {
                    setConfirm(null);
                    onChecked([]);
                  }
                });
              }}
            >
              {l.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

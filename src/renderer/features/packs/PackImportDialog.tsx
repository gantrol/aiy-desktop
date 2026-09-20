import { useState } from 'react';
import type { PackImportPreviewDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onApplied(packId: string): void | Promise<void>;
  notify(message: string): void;
}

export function PackImportDialog({ open, onOpenChange, onApplied, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.packs.importDialog;
  const [preview, setPreview] = useState<PackImportPreviewDto | null>(null);
  const [pending, setPending] = useState(false);

  async function discardPreview() {
    const requestId = preview?.requestId;
    setPreview(null);
    if (requestId) await window.desktopApi.packDiscardImport(requestId);
  }

  async function close() {
    if (pending) return;
    try {
      await discardPreview();
    } finally {
      onOpenChange(false);
    }
  }

  async function choosePack() {
    setPending(true);
    try {
      await discardPreview();
      const result = await window.desktopApi.packImportLocal();
      if (result.status === 'preview') setPreview(result.preview);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  async function applyPack() {
    if (!preview) return;
    setPending(true);
    try {
      const result = await window.desktopApi.packApplyImport({ requestId: preview.requestId });
      setPreview(null);
      await onApplied(result.packId);
      onOpenChange(false);
    } catch (reason) {
      setPreview(null);
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  const summary = preview?.summary;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void close();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{preview ? preview.displayName : l.title}</DialogTitle>
        </DialogHeader>

        {preview && summary ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{l.operations[preview.operation]}</Badge>
              <span className="text-muted-foreground">{preview.currentVersion ?? '—'}</span>
              <span aria-hidden="true">→</span>
              <span className="font-medium">{preview.targetVersion}</span>
            </div>

            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-sm sm:grid-cols-6">
              {(['added', 'updated', 'removed', 'unchanged', 'localForks', 'conflicts'] as const).map((key) => (
                <div key={key} className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.summary[key]}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{summary[key]}</dd>
                </div>
              ))}
            </dl>

            {preview.changes.length > 0 && (
              <ScrollArea className="max-h-64 border-y">
                <div className="divide-y">
                  {preview.changes.map((change) => (
                    <div
                      key={`${change.changeKind}:${change.itemKey}`}
                      className="flex items-center gap-3 px-1 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{change.itemKey}</span>
                      {change.localState !== 'FOLLOW_PACK' && (
                        <Badge variant="secondary">{l.localStates[change.localState]}</Badge>
                      )}
                      <Badge variant="outline">{l.changeKinds[change.changeKind]}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void choosePack()}>
            {l.choose}
          </Button>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void close()}>
            {l.cancel}
          </Button>
          {preview && (
            <Button
              type="button"
              disabled={pending || Boolean(preview.blockingConflicts)}
              title={preview.blockingConflicts ? l.creationConflict : undefined}
              onClick={() => void applyPack()}
            >
              {l.apply[preview.operation]}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

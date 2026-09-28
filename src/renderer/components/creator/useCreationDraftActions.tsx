import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { CreationDraftUndoNotice, type DraftUndoEntry } from '@/renderer/components/creator/CreationDraftUndoNotice';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  spaceId: string;
  blocked: boolean;
  notify(message: string): void;
  refresh(): void;
  onBeforeDelete(draftId: string | null): Promise<void>;
  onDeleted(draftIds: string[]): void;
}

export function useCreationDraftActions(options: Options) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const [confirmSpace, setConfirmSpace] = useState<string | null>(null);
  const [entries, setEntries] = useState<DraftUndoEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const nextId = useRef(0);
  const currentSpace = useStableCallback(() => options.spaceId);
  const dismiss = useStableCallback((id: number) =>
    setEntries((current) => current.filter((entry) => entry.id !== id)),
  );

  const remove = useStableCallback(async (draftId: string | null) => {
    if (busyRef.current || options.blocked) return;
    const spaceId = options.spaceId;
    busyRef.current = true;
    setBusy(true);
    try {
      await options.onBeforeDelete(draftId);
      if (currentSpace() !== spaceId) return;
      const deletion = await window.desktopApi.creationDraftDelete({ spaceId, draftId });
      if (currentSpace() !== spaceId) return;
      options.onDeleted(deletion.draftIds);
      options.refresh();
      setConfirmSpace(null);
      if (deletion.draftIds.length) {
        const entry = { id: ++nextId.current, deletion, expiresAt: Date.now() + 3000 };
        setEntries((current) => [...current.filter((item) => item.expiresAt > Date.now()), entry]);
      }
    } catch {
      if (currentSpace() === spaceId) options.notify(labels.deleteDraftsFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  });

  const undo = useStableCallback(async (entry: DraftUndoEntry) => {
    if (
      busyRef.current ||
      options.blocked ||
      entry.deletion.spaceId !== options.spaceId ||
      entry.expiresAt <= Date.now()
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      await window.desktopApi.creationDraftRestore(entry.deletion);
      dismiss(entry.id);
      if (currentSpace() === entry.deletion.spaceId) options.refresh();
    } catch {
      if (currentSpace() === entry.deletion.spaceId) options.notify(labels.restoreDraftsFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  });

  return {
    busy: busy || options.blocked,
    remove,
    requestClear: () => setConfirmSpace(options.spaceId),
    feedback: (
      <>
        <Dialog
          open={confirmSpace === options.spaceId}
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmSpace(null);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{labels.clearDraftsTitle}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmSpace(null)}>
                {messages.common.cancel}
              </Button>
              <Button variant="destructive" disabled={busy || options.blocked} onClick={() => void remove(null)}>
                {labels.clearDrafts}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <CreationDraftUndoNotice
          entries={entries.filter((entry) => entry.deletion.spaceId === options.spaceId)}
          busy={busy || options.blocked}
          onUndo={(entry) => void undo(entry)}
          onDismiss={dismiss}
        />
      </>
    ),
  };
}

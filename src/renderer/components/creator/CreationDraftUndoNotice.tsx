import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreationDraftDeletion } from '@/shared/contracts/creation-draft-deletion';

export interface DraftUndoEntry {
  id: number;
  expiresAt: number;
  deletion: CreationDraftDeletion;
}

function Notice({
  entry,
  busy,
  onUndo,
  onDismiss,
}: {
  entry: DraftUndoEntry;
  busy: boolean;
  onUndo(entry: DraftUndoEntry): void;
  onDismiss(id: number): void;
}) {
  const labels = useI18n().messages.creator.results;
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(entry.id), Math.max(0, entry.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [entry.expiresAt, entry.id, onDismiss]);
  return (
    <li
      role="status"
      className="pointer-events-auto flex items-center gap-3 rounded-sm border bg-overlay px-3 py-2 text-sm"
    >
      <span>{labels.deletedDrafts(entry.deletion.draftIds.length)}</span>
      <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onUndo(entry)}>
        {labels.undoDeleteDrafts}
      </Button>
    </li>
  );
}

export function CreationDraftUndoNotice({
  entries,
  busy,
  onUndo,
  onDismiss,
}: {
  entries: DraftUndoEntry[];
  busy: boolean;
  onUndo(entry: DraftUndoEntry): void;
  onDismiss(id: number): void;
}) {
  if (!entries.length) return null;
  return createPortal(
    <ol
      data-overlay-layer="toast"
      className="pointer-events-none fixed bottom-4 right-4 z-toast flex flex-col items-end gap-2"
    >
      {entries.map((entry) => (
        <Notice key={entry.id} entry={entry} busy={busy} onUndo={onUndo} onDismiss={onDismiss} />
      ))}
    </ol>,
    document.body,
  );
}

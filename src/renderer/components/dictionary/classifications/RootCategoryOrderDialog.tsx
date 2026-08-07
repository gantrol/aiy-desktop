import type { DictionaryClassificationNodeDto, Locale } from '@/shared/contracts';
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

interface Props {
  locale: Locale;
  open: boolean;
  roots: readonly DictionaryClassificationNodeDto[];
  busy: boolean;
  onClose(): void;
  onSave(orderedIds: string[]): void;
}

function moveId(ids: readonly string[], sourceId: string, targetIndex: number) {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0 || sourceIndex === targetIndex) return [...ids];
  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

export function RootCategoryOrderDialog({ locale, open, roots, busy, onClose, onSave }: Props) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rootIds = useMemo(() => roots.map((root) => root.id), [roots]);
  const rootById = useMemo(() => new Map(roots.map((root) => [root.id, root])), [roots]);
  const changed = orderedIds.some((id, index) => id !== rootIds[index]);
  const number = new Intl.NumberFormat(locale);

  useEffect(() => {
    if (!open) return;
    setOrderedIds(rootIds);
    setDraggingId(null);
  }, [open, rootIds]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.orderTopLevelTitle}</DialogTitle>
          <DialogDescription>{copy.orderTopLevelDescription}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(30rem,60vh)] overflow-y-auto rounded-lg border bg-surface-sunken p-2">
          {orderedIds.map((id, index) => {
            const root = rootById.get(id);
            if (!root) return null;
            return (
              <div
                key={id}
                draggable={!busy}
                className="mb-1 flex h-12 items-center gap-2 rounded-md border bg-surface px-2 last:mb-0"
                onDragStart={(event) => {
                  setDraggingId(id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', id);
                }}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => {
                  if (!draggingId || draggingId === id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggingId ?? event.dataTransfer.getData('text/plain');
                  if (sourceId && sourceId !== id) setOrderedIds((current) => moveId(current, sourceId, index));
                  setDraggingId(null);
                }}
              >
                <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{root.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {copy.termCount(number.format(root.subtreeTermCount))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === 0}
                  aria-label={copy.moveTopLevelUp(root.name)}
                  title={copy.moveTopLevelUp(root.name)}
                  onClick={() => setOrderedIds((current) => moveId(current, id, index - 1))}
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === orderedIds.length - 1}
                  aria-label={copy.moveTopLevelDown(root.name)}
                  title={copy.moveTopLevelDown(root.name)}
                  onClick={() => setOrderedIds((current) => moveId(current, id, index + 1))}
                >
                  <ArrowDownIcon className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="button" disabled={busy || !changed} onClick={() => onSave(orderedIds)}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {copy.saveTopLevelOrder}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

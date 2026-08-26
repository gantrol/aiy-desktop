import type { ContentLifecyclePlanDto, ContentLifecyclePurgePlanDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { useI18n } from '@/renderer/i18n/useI18n';

export type ContentLifecycleConfirmation =
  | { kind: 'RESTORE'; title: string; albumCount: number; contentCount: number }
  | { kind: 'DELETE'; title: string; plan: ContentLifecyclePlanDto }
  | { kind: 'PURGE'; title: string; plan: ContentLifecyclePurgePlanDto; clear: boolean };

interface Props {
  confirmation: ContentLifecycleConfirmation | null;
  submitting: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function ContentLifecycleConfirmationDialog({ confirmation, submitting, onCancel, onConfirm }: Props) {
  const { messages } = useI18n();
  const l = messages.contentManagement;
  if (!confirmation) return null;

  const dialogTitle =
    confirmation.kind === 'RESTORE'
      ? l.confirm.restoreTitle
      : confirmation.kind === 'DELETE'
        ? l.confirm.deleteTitle
        : confirmation.clear
          ? l.confirm.clearTitle
          : l.confirm.permanentDeleteTitle;
  const confirmLabel =
    confirmation.kind === 'RESTORE'
      ? l.confirm.restore
      : confirmation.kind === 'DELETE'
        ? l.confirm.delete
        : confirmation.clear
          ? l.confirm.clear
          : l.confirm.permanentDelete;
  const impact =
    confirmation.kind === 'RESTORE'
      ? { albumCount: confirmation.albumCount, contentCount: confirmation.contentCount }
      : confirmation.plan;

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 rounded-md bg-surface-sunken px-3 py-2.5">
          <strong className="truncate text-sm font-medium">{confirmation.title}</strong>
          {impact.albumCount > 0 && <MetaText>{l.confirm.impact(impact.albumCount, impact.contentCount)}</MetaText>}
          {confirmation.kind === 'PURGE' && <MetaText>{l.count(confirmation.plan.count)}</MetaText>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            variant={confirmation.kind === 'RESTORE' ? 'default' : 'destructive'}
            disabled={submitting}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

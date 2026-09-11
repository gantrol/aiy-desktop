import { LoaderCircleIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ContentLifecycleAction, ContentLifecyclePlanDto, ContentLifecycleTarget } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface ContentLifecycleActionRequest {
  action: ContentLifecycleAction;
  target: ContentLifecycleTarget;
  title: string;
}

interface PendingAction {
  request: ContentLifecycleActionRequest;
  plan: ContentLifecyclePlanDto;
}

export function useContentLifecycleActions({
  notify,
  onApplied,
}: {
  notify(message: string): void;
  onApplied(request: ContentLifecycleActionRequest): void | Promise<void>;
}): {
  busy: boolean;
  request(input: ContentLifecycleActionRequest): Promise<void>;
  confirmationDialog: ReactNode;
} {
  const { messages } = useI18n();
  const l = messages.contentManagement;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function failureMessage(reason: unknown) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    return detail.includes('IMAGE_ASSET_USED_BY_ACTIVE_CONTENT') ? l.notices.assetInUse : detail;
  }

  async function apply(request: ContentLifecycleActionRequest, plan: ContentLifecyclePlanDto) {
    await window.desktopApi.contentLifecycleApply({
      action: request.action,
      targets: [request.target],
      confirmationToken: plan.confirmationToken,
    });
    await onApplied(request);
    notify(request.action === 'ARCHIVE' ? l.notices.archived : l.notices.deleted);
  }

  async function request(input: ContentLifecycleActionRequest) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const plan = await window.desktopApi.contentLifecyclePlan({ action: input.action, targets: [input.target] });
      const albumHasContents = input.target.entityType === 'ALBUM' && plan.count > 1;
      if (input.action === 'DELETE' || albumHasContents) {
        setPending({ request: input, plan });
        return;
      }
      await apply(input, plan);
    } catch (reason) {
      notify(failureMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      await apply(pending.request, pending.plan);
      setPending(null);
    } catch (reason) {
      setError(failureMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = pending?.request.action === 'ARCHIVE' ? l.confirm.archive : l.confirm.delete;
  const confirmationDialog = (
    <Dialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setPending(null);
          setError('');
        }
      }}
    >
      <DialogContent data-dialog="content-lifecycle-action" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>
            {pending?.request.action === 'ARCHIVE' ? l.confirm.archiveTitle : l.confirm.deleteTitle}
          </DialogTitle>
        </DialogHeader>
        {pending && (
          <div className="grid gap-1 rounded-md bg-surface-sunken px-3 py-2.5">
            <strong className="truncate text-sm font-medium">{pending.request.title}</strong>
            <MetaText>{l.confirm.impact(pending.plan.albumCount, pending.plan.contentCount)}</MetaText>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)}>
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            variant={pending?.request.action === 'DELETE' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { busy, request, confirmationDialog };
}

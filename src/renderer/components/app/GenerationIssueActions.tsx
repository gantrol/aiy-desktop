import { PencilLineIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import type { GenerationStatus } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';

interface Props {
  status: GenerationStatus;
  busy: boolean;
  reEditLabel: string;
  retryLabel: string;
  regenerateLabel: string;
  dismissLabel: string;
  onReEdit(): void;
  onRetry(): void;
  onDismiss(): void;
}

export function GenerationIssueActions({
  status,
  busy,
  reEditLabel,
  retryLabel,
  regenerateLabel,
  dismissLabel,
  onReEdit,
  onRetry,
  onDismiss,
}: Props) {
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" disabled={busy} onClick={onReEdit}>
        <PencilLineIcon className="size-3" />
        {reEditLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" disabled={busy} onClick={onRetry}>
        <RotateCcwIcon className="size-3" />
        {status === 'INTERRUPTED' ? regenerateLabel : retryLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0"
        title={dismissLabel}
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" />
      </Button>
    </>
  );
}

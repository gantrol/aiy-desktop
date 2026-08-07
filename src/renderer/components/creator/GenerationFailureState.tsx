import type { GenerationRunDto } from '@/shared/contracts';
import { GenerationErrorNotice } from '@/renderer/components/generation/GenerationErrorNotice';
import { Button } from '@/renderer/components/ui/button';
import { StatusDot } from '@/renderer/components/ui/status-dot';

interface Props {
  /** `message` remains available for non-persisted/synthetic failures. */
  message?: string;
  run?: GenerationRunDto;
  retryLabel: string;
  editLabel?: string;
  disabled: boolean;
  onRetry(): void;
  onEdit?(): void;
}

export function GenerationFailureState({ message, run, retryLabel, editLabel, disabled, onRetry, onEdit }: Props) {
  return (
    <div
      data-generation-failure
      className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
    >
      {run ? (
        <GenerationErrorNotice
          run={run}
          className="max-w-xl justify-center"
          summaryClassName="leading-relaxed"
          align="center"
        />
      ) : (
        <StatusDot variant="error" label={message ?? ''} labelVisibility="visible" />
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {editLabel && onEdit && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
            {editLabel}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}

import { ChevronRightIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { GifWorkspaceState } from '@/shared/contracts/gif-making';

type GifWorkflowStep = GifWorkspaceState['step'];

export function GifWorkflowNav({
  step,
  running,
  disabled,
  onChange,
}: {
  step: GifWorkflowStep;
  running: boolean;
  disabled: boolean;
  onChange(step: GifWorkflowStep): void;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  const steps = [
    { id: 'generate', label: labels.generation.prepare },
    { id: 'review', label: labels.generation.review },
    { id: 'edit', label: labels.assembly },
  ] as const;
  return (
    <nav className="shrink-0 overflow-x-auto border-b px-3 py-2" aria-label={labels.workflow}>
      <ol className="flex items-center gap-1">
        {steps.map((item, index) => (
          <li key={item.id} className="flex shrink-0 items-center gap-1">
            {index > 0 && <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />}
            <Button
              data-action={`gif-workflow-${item.id}`}
              size="sm"
              variant={step === item.id ? 'secondary' : 'ghost'}
              aria-current={step === item.id ? 'step' : undefined}
              disabled={disabled}
              onClick={() => onChange(item.id)}
            >
              {item.id === 'generate' && running ? (
                <LoaderCircleIcon className="size-3 animate-spin" />
              ) : (
                <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              )}
              {item.label}
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import { AppSidebarButton } from '@/renderer/components/app/AppSidebarButton';
import { useAppUpdate } from '@/renderer/features/app-update/useAppUpdate';
import { cn } from '@/renderer/lib/utils';

export function AppUpdateSidebarButton() {
  const { state, busy, progress, status, action, needsAttention, run } = useAppUpdate(true);
  const visible = needsAttention || state?.phase === 'CHECKING';
  const failed = state?.phase === 'ERROR' || (!state && needsAttention);
  const label = [status, state?.targetVersion, action?.label].filter(Boolean).join(' · ');

  return (
    <div className={visible ? 'relative flex shrink-0 flex-col items-center' : 'sr-only'}>
      <span className="sr-only" aria-live="polite">
        {visible ? status : null}
      </span>
      {visible && (
        <AppSidebarButton
          icon={busy ? LoaderCircleIcon : (action?.icon ?? CircleAlertIcon)}
          label={label}
          aria-disabled={busy || !action}
          className={cn(
            'text-selected-foreground',
            failed && 'text-destructive hover:text-destructive',
            busy && '[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none',
          )}
          onClick={() => {
            if (!busy && action) void run(action.run);
          }}
        />
      )}
      {state?.phase === 'DOWNLOADING' && (
        <div
          className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 overflow-hidden bg-surface-sunken"
          role="progressbar"
          aria-label={status ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span
            className="block h-full bg-selected-foreground transition-[width] duration-base motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

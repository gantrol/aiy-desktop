import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useAppUpdate } from '@/renderer/features/app-update/useAppUpdate';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AppUpdateSection({ active }: { active: boolean }) {
  const { messages } = useI18n();
  const l = messages.app.settings;
  const { state, busy, progress, status, action, needsAttention, requestFailed, run } = useAppUpdate(active);
  if (!state && !requestFailed) return null;

  const ActionIcon = action?.icon;
  return (
    <div className={needsAttention ? 'grid gap-2 rounded-md border bg-background p-3' : 'grid gap-2 px-1.5'}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p
          className={needsAttention ? 'min-w-0 text-xs text-foreground' : 'min-w-0 text-xs text-muted-foreground'}
          aria-live="polite"
        >
          <span className="tabular-nums">
            {l.currentVersion}: {state?.currentVersion ?? '—'}
            {state?.targetVersion && state.targetVersion !== state.currentVersion ? ` → ${state.targetVersion}` : ''}
          </span>
          {status && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{status}</span>
            </>
          )}
        </p>
        {action && ActionIcon && (
          <Button
            type="button"
            variant={needsAttention ? 'outline' : 'ghost'}
            size="sm"
            className={needsAttention ? undefined : 'px-2 text-muted-foreground'}
            disabled={busy}
            onClick={() => void run(action.run)}
          >
            {busy ? (
              <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <ActionIcon className="size-4" />
            )}
            {action.label}
          </Button>
        )}
      </div>
      {state?.phase === 'DOWNLOADING' && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-label={l.downloadingUpdate(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span
            className="block h-full rounded-full bg-selected-foreground transition-[width] duration-base motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

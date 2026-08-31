import { LoaderCircleIcon, PauseIcon, PlayIcon, ScanLineIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';

export type CodexUsageTaskAction = 'SCAN' | 'PAUSE' | 'RESUME' | null;

export function CodexUsageTaskControls({
  running,
  resumable,
  action,
  authorized,
  labels,
  onScan,
  onPause,
  onResume,
}: {
  running: boolean;
  resumable: boolean;
  action: CodexUsageTaskAction;
  authorized: boolean;
  labels: { scan: string; pause: string; resume: string };
  onScan(): void;
  onPause(): void;
  onResume(): void;
}) {
  return (
    <>
      {running ? (
        <Button type="button" variant="outline" disabled={action !== null} onClick={onPause}>
          {action === 'PAUSE' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PauseIcon className="size-4" />}
          {labels.pause}
        </Button>
      ) : resumable ? (
        <Button type="button" variant="outline" disabled={action !== null} onClick={onResume}>
          {action === 'RESUME' ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
          {labels.resume}
        </Button>
      ) : null}
      {!running && (
        <Button type="button" disabled={!authorized || action !== null} onClick={onScan}>
          {action === 'SCAN' ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <ScanLineIcon className="size-4" />
          )}
          {labels.scan}
        </Button>
      )}
    </>
  );
}

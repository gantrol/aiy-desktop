import { XIcon } from 'lucide-react';
import type { VideoDocumentTranscriptBackgroundTask } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  task: VideoDocumentTranscriptBackgroundTask;
  nowMs: number;
  busy: boolean;
  onCancel(): void;
}

function elapsedLabel(startedAt: string, nowMs: number) {
  const parsed = Date.parse(startedAt);
  const elapsedSeconds = Number.isFinite(parsed) ? Math.max(0, Math.floor((nowMs - parsed) / 1_000)) : 0;
  return `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
}

export function VideoDocumentTranscriptTaskCenterItem({ task, nowMs, busy, onCancel }: Props) {
  const labels = useI18n().messages.app.generationStatus;
  const progressPercent =
    task.totalChunks === null ? null : Math.min(100, Math.round((task.completedChunks / task.totalChunks) * 100));
  const phase =
    task.status === 'STARTING'
      ? labels.transcriptStarting
      : task.status === 'CANCELLING'
        ? labels.cancelling
        : progressPercent === null
          ? labels.transcribing
          : labels.transcribingProgress(progressPercent);
  return (
    <div className="flex h-10 items-center gap-2 border-b px-3 text-xs last:border-b-0">
      <span className="min-w-0 flex-1 truncate" title={`${task.documentTitle} · ${task.modelId}`}>
        {task.documentTitle}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {phase} · {elapsedLabel(task.startedAt, nowMs)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        disabled={busy || task.status === 'CANCELLING'}
        title={labels.cancel}
        aria-label={labels.cancel}
        onClick={onCancel}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

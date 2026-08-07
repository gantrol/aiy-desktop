import type { GenerationTaskDto } from '@/shared/contracts';

export interface GenerationPhaseLabels {
  queued: string | ((position: number | null) => string);
  preparing: string;
  submitting: string;
  uploading: string;
  waitingProvider: string;
  generating: string;
  downloading: string;
  finalizing: string;
  saving: string;
  recovering: string;
  cancelling: string;
}

export function generationPhaseLabel(task: GenerationTaskDto, labels: GenerationPhaseLabels) {
  let label: string;
  switch (task.phase) {
    case 'QUEUED':
      label =
        typeof labels.queued === 'function'
          ? labels.queued(task.queuePosition)
          : `${labels.queued}${task.queuePosition ? ` ${task.queuePosition}` : ''}`;
      break;
    case 'PREPARING':
      label = labels.preparing;
      break;
    case 'SUBMITTING':
      label = labels.submitting;
      break;
    case 'UPLOADING':
      label = labels.uploading;
      break;
    case 'WAITING_PROVIDER':
      label = labels.waitingProvider;
      break;
    case 'GENERATING':
      label = labels.generating;
      break;
    case 'DOWNLOADING':
      label = labels.downloading;
      break;
    case 'FINALIZING':
      label = labels.finalizing;
      break;
    case 'SAVING':
      label = labels.saving;
      break;
    case 'RECOVERING':
      label = labels.recovering;
      break;
    case 'CANCELLING':
      label = labels.cancelling;
      break;
  }
  return task.progress == null || task.phase === 'QUEUED'
    ? label
    : `${label} ${Math.round(Math.max(0, Math.min(1, task.progress)) * 100)}%`;
}

export function generationElapsed(task: GenerationTaskDto, nowMs: number) {
  if (task.phase === 'QUEUED') return '';
  const since = Date.parse(task.startedAt ?? task.submittedAt);
  if (!Number.isFinite(since)) return '';
  const seconds = Math.max(0, Math.floor((nowMs - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

import type {
  GenerationQuality,
  GenerationStatus,
  TermIllustrationBatchDto,
  TermIllustrationDecision,
} from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/catalog';

type IllustrationCopy = MessageCatalog['dictionary']['detail']['illustration'];

export function runStatusLabel(status: GenerationStatus, copy: IllustrationCopy) {
  if (status === 'QUEUED') return copy.queued;
  if (status === 'RUNNING') return copy.running;
  if (status === 'SUCCEEDED') return copy.succeeded;
  if (status === 'FAILED') return copy.failed;
  if (status === 'CANCELLED') return copy.cancelled;
  return copy.interrupted;
}

export function decisionLabel(decision: TermIllustrationDecision, copy: IllustrationCopy) {
  if (decision === 'ADOPTED_COVER') return copy.adoptedCover;
  if (decision === 'ADOPTED_RELATED') return copy.adoptedRelated;
  if (decision === 'DISMISSED') return copy.dismissed;
  return copy.pending;
}

export function qualityLabel(quality: GenerationQuality, copy: IllustrationCopy) {
  if (quality === 'low') return copy.qualityLow;
  if (quality === 'medium') return copy.qualityMedium;
  if (quality === 'high') return copy.qualityHigh;
  if (quality === 'xhigh') return copy.qualityXhigh;
  return copy.qualityMax;
}

export function batchStatusLabel(batch: TermIllustrationBatchDto, copy: IllustrationCopy) {
  if (batch.status === 'FAILED') return copy.failed;
  if (batch.status === 'PREPARING') return copy.queued;
  if (batch.runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING')) return copy.running;
  if (batch.runs.some((run) => run.status === 'SUCCEEDED')) return copy.succeeded;
  return batch.runs[0] ? runStatusLabel(batch.runs[0].status, copy) : copy.failed;
}

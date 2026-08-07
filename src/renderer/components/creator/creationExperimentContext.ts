import type {
  PromptSeriesDto,
  PromptVersionDto,
  StyleExplorationBatchDto,
  StyleExplorationSlotDto,
} from '@/shared/contracts';

export interface CreationExperimentContext {
  batch: StyleExplorationBatchDto;
  slot: StyleExplorationSlotDto;
  sourceSeries: PromptSeriesDto | null;
  sourceVersion: PromptVersionDto | null;
  directionNo: number;
  directionCount: number;
  versionLabel: string;
}

function sourceVersionForBatch(batch: StyleExplorationBatchDto, series: readonly PromptSeriesDto[]) {
  if (batch.scope.kind !== 'SERIES') return null;
  const sourceSeries = series.find((item) => item.id === batch.scope.id);
  if (!sourceSeries) return null;
  const versionsAtStart = sourceSeries.versions
    .filter((version) => version.createdAt <= batch.createdAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.versionNo - left.versionNo);
  return (
    versionsAtStart[0] ??
    sourceSeries.versions.find((version) => version.id === sourceSeries.currentVersionId) ??
    [...sourceSeries.versions].sort((left, right) => right.versionNo - left.versionNo)[0] ??
    null
  );
}

function sameScope(left: StyleExplorationBatchDto, right: StyleExplorationBatchDto) {
  return left.scope.kind === right.scope.kind && left.scope.id === right.scope.id;
}

/**
 * Presents an experiment direction as a child coordinate of the frozen source
 * revision: V6.1, V6.2, ... . PromptVersion.versionNo remains an integer and
 * continues to describe accepted revisions; this label is experiment lineage.
 */
export function creationExperimentContextForSeries(
  seriesId: string | null | undefined,
  series: readonly PromptSeriesDto[],
  batches: readonly StyleExplorationBatchDto[],
): CreationExperimentContext | null {
  if (!seriesId) return null;
  const orderedBatches = [...batches].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const batch = [...orderedBatches].reverse().find((item) => item.slots.some((slot) => slot.seriesId === seriesId));
  if (!batch) return null;
  const slot = batch.slots.find((item) => item.seriesId === seriesId);
  if (!slot) return null;

  const sourceSeries =
    batch.scope.kind === 'SERIES' ? (series.find((item) => item.id === batch.scope.id) ?? null) : null;
  const sourceVersion = sourceVersionForBatch(batch, series);
  const baseVersionNo = sourceVersion?.versionNo ?? 1;
  const priorDirectionCount = orderedBatches
    .filter(
      (candidate) =>
        candidate.createdAt < batch.createdAt || (candidate.createdAt === batch.createdAt && candidate.id < batch.id),
    )
    .filter((candidate) => sameScope(candidate, batch))
    .filter((candidate) => (sourceVersionForBatch(candidate, series)?.versionNo ?? 1) === baseVersionNo)
    .reduce((count, candidate) => count + candidate.slots.length, 0);
  const directionNo = priorDirectionCount + slot.sortOrder + 1;

  return {
    batch,
    slot,
    sourceSeries,
    sourceVersion,
    directionNo,
    directionCount: batch.slots.length,
    versionLabel: `V${baseVersionNo}.${directionNo}`,
  };
}

import type { PromptSeriesDto, StyleExplorationBatchDto } from '@/shared/contracts';

export interface CreationSessionProjection {
  id: string;
  primarySeries: PromptSeriesDto;
  memberSeries: PromptSeriesDto[];
  batches: StyleExplorationBatchDto[];
  directionCount: number;
  syntheticExperimentRoot: boolean;
}

/**
 * PromptSeries remain the immutable owners of prompt versions and outputs, but
 * experiment-only series are navigation branches rather than top-level user
 * sessions. This projection groups them under the source series without
 * rewriting existing lineage or assets.
 */
export function buildCreationSessionProjection(
  series: readonly PromptSeriesDto[],
  batches: readonly StyleExplorationBatchDto[],
): CreationSessionProjection[] {
  const seriesById = new Map(series.map((item) => [item.id, item]));
  const seriesOrder = new Map(series.map((item, index) => [item.id, index]));
  const batchesByHost = new Map<string, StyleExplorationBatchDto[]>();
  const childSeriesIds = new Set<string>();
  const attachedBatchIds = new Set<string>();

  for (const batch of batches) {
    const slotSeriesIds = [...new Set(batch.slots.map((slot) => slot.seriesId))].filter((seriesId) =>
      seriesById.has(seriesId),
    );
    if (batch.scope.kind === 'SERIES' && seriesById.has(batch.scope.id)) {
      const current = batchesByHost.get(batch.scope.id) ?? [];
      current.push(batch);
      batchesByHost.set(batch.scope.id, current);
      attachedBatchIds.add(batch.id);
      for (const seriesId of slotSeriesIds) {
        if (seriesId !== batch.scope.id) childSeriesIds.add(seriesId);
      }
    }
  }

  const projections: Array<CreationSessionProjection & { order: number }> = [];
  for (const primarySeries of series) {
    if (childSeriesIds.has(primarySeries.id)) continue;
    const attachedBatches = batchesByHost.get(primarySeries.id) ?? [];
    const memberIds = new Set<string>([primarySeries.id]);
    for (const batch of attachedBatches) {
      for (const slot of batch.slots) {
        if (seriesById.has(slot.seriesId)) memberIds.add(slot.seriesId);
      }
    }
    const memberSeries = [...memberIds].flatMap((id) => seriesById.get(id) ?? []);
    projections.push({
      id: `series:${primarySeries.id}`,
      primarySeries,
      memberSeries,
      batches: attachedBatches,
      directionCount: attachedBatches.reduce((count, batch) => count + batch.slots.length, 0),
      syntheticExperimentRoot: false,
      order: Math.min(...memberSeries.map((item) => seriesOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER)),
    });
  }

  // A historical experiment may still point at a draft that was consumed
  // before scope re-homing existed. Keep it as one synthetic session instead
  // of exposing every direction as a separate root row.
  const syntheticClaimedSeriesIds = new Set<string>();
  for (const batch of batches) {
    if (attachedBatchIds.has(batch.id)) continue;
    const memberSeries = [...new Set(batch.slots.map((slot) => slot.seriesId))]
      .filter((id) => !syntheticClaimedSeriesIds.has(id))
      .flatMap((id) => seriesById.get(id) ?? []);
    if (memberSeries.length === 0) continue;
    for (const item of memberSeries) syntheticClaimedSeriesIds.add(item.id);
    projections.push({
      id: `experiment:${batch.id}`,
      primarySeries: memberSeries[0],
      memberSeries,
      batches: [batch],
      directionCount: batch.slots.length,
      syntheticExperimentRoot: true,
      order: Math.min(...memberSeries.map((item) => seriesOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER)),
    });
  }

  const syntheticMemberIds = new Set(
    projections
      .filter((projection) => projection.syntheticExperimentRoot)
      .flatMap((projection) => projection.memberSeries.map((item) => item.id)),
  );

  return projections
    .filter((projection) => projection.syntheticExperimentRoot || !syntheticMemberIds.has(projection.primarySeries.id))
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...projection }) => projection);
}

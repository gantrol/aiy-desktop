import type { PromptSeriesDto, StyleExplorationSlotDto } from '@/shared/contracts';

export function styleExplorationSlotAssets(slot: StyleExplorationSlotDto, series: readonly PromptSeriesDto[]) {
  const owner = series.find((item) => item.id === slot.seriesId);
  const version = owner?.versions.find((item) => item.id === slot.versionId);
  const allowedRunIds = new Set(slot.runIds);
  return (version?.runs ?? []).flatMap((run) =>
    run.asset && run.outputDisposition !== 'FAILED' && allowedRunIds.has(run.id) ? [run.asset] : [],
  );
}

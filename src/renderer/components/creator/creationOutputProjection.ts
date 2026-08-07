import type {
  AssetDto,
  GenerationRunDto,
  PromptSeriesDto,
  PromptVersionDto,
  StyleExplorationBatchDto,
  StyleExplorationSlotDto,
} from '@/shared/contracts';

export interface CreationOutputAssetProjection {
  asset: AssetDto;
  run: GenerationRunDto;
  lineageRootRunId: string;
}

export interface CreationOutputDirectionStack {
  id: string;
  versionLabel: string;
  directionNo: number;
  batch: StyleExplorationBatchDto;
  slot: StyleExplorationSlotDto;
  series: PromptSeriesDto | null;
  version: PromptVersionDto | null;
  assets: CreationOutputAssetProjection[];
  failedAssets: CreationOutputAssetProjection[];
}

export interface CreationOutputVersionGroup {
  id: string;
  versionLabel: string;
  version: PromptVersionDto;
  primaryAssets: CreationOutputAssetProjection[];
  failedPrimaryAssets: CreationOutputAssetProjection[];
  directionStacks: CreationOutputDirectionStack[];
}

function compareRunsNewestFirst(left: GenerationRunDto, right: GenerationRunDto) {
  const leftTime = left.asset?.createdAt ?? left.createdAt;
  const rightTime = right.asset?.createdAt ?? right.createdAt;
  return (
    rightTime.localeCompare(leftTime) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

/**
 * A retry replaces one logical generation position. Keep the newest successful
 * artifact in each retry lineage and then de-duplicate by asset identity. This
 * prevents a refreshed DTO or reconciled retry chain from stacking one image
 * more than once while retaining independent model/count positions.
 */
function projectRunAssets(runs: readonly GenerationRunDto[]): CreationOutputAssetProjection[] {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const rootByRunId = new Map<string, string>();

  function lineageRoot(run: GenerationRunDto) {
    const cached = rootByRunId.get(run.id);
    if (cached) return cached;
    const visited = new Set<string>([run.id]);
    let current = run;
    while (current.retryOfRunId) {
      const parent = runById.get(current.retryOfRunId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }
    for (const runId of visited) rootByRunId.set(runId, current.id);
    return current.id;
  }

  const newestSuccessfulByRoot = new Map<string, GenerationRunDto>();
  for (const run of runs) {
    if (!run.asset) continue;
    const root = lineageRoot(run);
    const current = newestSuccessfulByRoot.get(root);
    if (!current || compareRunsNewestFirst(run, current) < 0) newestSuccessfulByRoot.set(root, run);
  }

  const byAssetId = new Map<string, CreationOutputAssetProjection>();
  for (const [lineageRootRunId, run] of newestSuccessfulByRoot) {
    const asset = run.asset!;
    const current = byAssetId.get(asset.id);
    if (!current || compareRunsNewestFirst(run, current.run) < 0) {
      byAssetId.set(asset.id, { asset, run, lineageRootRunId });
    }
  }
  return [...byAssetId.values()].sort((left, right) => compareRunsNewestFirst(left.run, right.run));
}

function splitRunAssets(runs: readonly GenerationRunDto[]) {
  const projected = projectRunAssets(runs);
  return {
    assets: projected.filter((item) => item.run.outputDisposition !== 'FAILED'),
    failedAssets: projected.filter((item) => item.run.outputDisposition === 'FAILED'),
  };
}

/**
 * Resolve the immutable major-version anchor of a batch. Normal series-scoped
 * experiments use the latest version existing when the batch was created. A
 * draft experiment may be re-homed before its first series version exists; in
 * that case the earliest subsequent version is its V1 anchor, not whatever
 * version happens to be current when the library is reopened.
 */
export function sourceVersionForExplorationBatch(
  primarySeries: PromptSeriesDto,
  batch: StyleExplorationBatchDto,
): PromptVersionDto | null {
  if (batch.scope.kind !== 'SERIES' || batch.scope.id !== primarySeries.id) return null;
  const ordered = [...primarySeries.versions].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.versionNo - right.versionNo ||
      left.id.localeCompare(right.id),
  );
  const atOrBefore = ordered.filter((version) => version.createdAt <= batch.createdAt).at(-1);
  if (atOrBefore) return atOrBefore;
  return ordered[0] ?? primarySeries.versions.find((version) => version.id === primarySeries.currentVersionId) ?? null;
}

/**
 * Project one creation's output into major versions. Direction series remain
 * the durable owners of their runs, but their result stacks are displayed next
 * to the source version as V6.1, V6.2, and so on.
 */
export function buildCreationOutputProjection(
  primarySeries: PromptSeriesDto,
  allSeries: readonly PromptSeriesDto[],
  batches: readonly StyleExplorationBatchDto[],
): CreationOutputVersionGroup[] {
  const seriesById = new Map(allSeries.map((series) => [series.id, series]));
  seriesById.set(primarySeries.id, primarySeries);
  const groups = [...primarySeries.versions]
    .sort(
      (left, right) =>
        right.versionNo - left.versionNo ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    )
    .map((version): CreationOutputVersionGroup => {
      const { assets, failedAssets } = splitRunAssets(version.runs);
      return {
        id: version.id,
        versionLabel: `V${version.versionNo}`,
        version,
        primaryAssets: assets,
        failedPrimaryAssets: failedAssets,
        directionStacks: [],
      };
    });
  const groupByVersionId = new Map(groups.map((group) => [group.version.id, group]));
  const directionCountByVersionId = new Map<string, number>();
  const uniqueBatches = [...new Map(batches.map((batch) => [batch.id, batch])).values()]
    .filter((batch) => batch.scope.kind === 'SERIES' && batch.scope.id === primarySeries.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  for (const batch of uniqueBatches) {
    const sourceVersion = sourceVersionForExplorationBatch(primarySeries, batch);
    if (!sourceVersion) continue;
    const group = groupByVersionId.get(sourceVersion.id);
    if (!group) continue;
    const slots = [...batch.slots].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
    for (const slot of slots) {
      const directionNo = (directionCountByVersionId.get(sourceVersion.id) ?? 0) + 1;
      directionCountByVersionId.set(sourceVersion.id, directionNo);
      const directionSeries = seriesById.get(slot.seriesId) ?? null;
      const directionVersion = directionSeries?.versions.find((version) => version.id === slot.versionId) ?? null;
      const allowedRunIds = new Set(slot.runIds);
      const { assets, failedAssets } = splitRunAssets(
        (directionVersion?.runs ?? []).filter((run) => allowedRunIds.has(run.id)),
      );
      group.directionStacks.push({
        id: `${batch.id}:${slot.id}`,
        versionLabel: `V${sourceVersion.versionNo}.${directionNo}`,
        directionNo,
        batch,
        slot,
        series: directionSeries,
        version: directionVersion,
        assets,
        failedAssets,
      });
    }
  }

  return groups;
}

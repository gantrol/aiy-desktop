import type { BootstrapDto, PromptSeriesDto } from '@/shared/contracts';
import {
  FEATURE_DEMO_SCENES,
  type FeatureDemoScene,
  type FeatureDemoSceneId,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

export interface FeatureDemoRunPlan {
  seed: number;
  scenes: readonly FeatureDemoScene[];
  styleBatchId: string | null;
  comparisonSeriesId: string | null;
  comparisonAssetId: string | null;
}

const FEATURE_DEMO_CHAPTERS: readonly (readonly FeatureDemoSceneId[])[] = [
  ['directionDetailsExpand', 'directionDetailsCollapse'],
  ['directoryExpand', 'directoryCollapse'],
  ['codexImages'],
  ['promptCompare'],
  ['videoDocument'],
] as const;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function chooseWeighted<T>(items: readonly T[], weight: (item: T) => number, random: () => number) {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, weight(item)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return items[0] ?? null;
  let threshold = random() * total;
  for (const entry of weighted) {
    threshold -= entry.weight;
    if (threshold < 0) return entry.item;
  }
  return weighted.at(-1)?.item ?? null;
}

function visibleSeriesImageIds(series: PromptSeriesDto) {
  const ids = new Set<string>();
  for (const version of series.versions) {
    for (const run of version.runs ?? []) {
      if (run.asset?.mimeType.startsWith('image/') && run.outputDisposition !== 'FAILED') ids.add(run.asset.id);
    }
  }
  for (const output of series.importedOutputs ?? []) {
    if (output.asset.mimeType.startsWith('image/')) ids.add(output.asset.id);
  }
  for (const output of series.transformedOutputs ?? []) {
    if (output.asset.mimeType.startsWith('image/')) ids.add(output.asset.id);
  }
  return [...ids];
}

export function createFeatureDemoSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]!;
}

export function createFeatureDemoRunPlan(data: BootstrapDto, seed = createFeatureDemoSeed()): FeatureDemoRunPlan {
  const random = seededRandom(seed);
  const sceneById = new Map(FEATURE_DEMO_SCENES.map((scene) => [scene.id, scene] as const));
  const scenes = shuffled(FEATURE_DEMO_CHAPTERS, random).flatMap((chapter) =>
    chapter.map((sceneId) => sceneById.get(sceneId)!),
  );
  const seriesImages = data.series.map((series) => ({ series, assetIds: visibleSeriesImageIds(series) }));
  const imageChoices = seriesImages.flatMap(({ series, assetIds }) =>
    assetIds.map((assetId) => ({ seriesId: series.id, assetId })),
  );
  const imageChoice = imageChoices[Math.floor(random() * imageChoices.length)] ?? null;
  const fallbackSeries = chooseWeighted(
    seriesImages,
    ({ series, assetIds }) => assetIds.length * 100 + series.versions.length * 10 + 1,
    random,
  );
  const comparisonSeriesId = imageChoice?.seriesId ?? fallbackSeries?.series.id ?? null;
  const comparisonAssetId = imageChoice?.assetId ?? fallbackSeries?.assetIds[0] ?? null;
  const imageCountBySeriesId = new Map(seriesImages.map(({ series, assetIds }) => [series.id, assetIds.length]));
  const styleBatch = chooseWeighted(
    data.styleExplorationBatches,
    (batch) =>
      Math.max(
        1,
        batch.slots.reduce((count, slot) => count + (imageCountBySeriesId.get(slot.seriesId) ?? 0), 0),
      ),
    random,
  );

  return {
    seed: seed >>> 0,
    scenes,
    styleBatchId: styleBatch?.id ?? null,
    comparisonSeriesId,
    comparisonAssetId,
  };
}

import type { TrainingDataset } from '@/shared/model-training';
import { digest } from '@/main/model-training/io';

/** Counts labeled relevance edges. Missing labels and model misses are separate concepts. */
export function classifyRelations(dataset: TrainingDataset) {
  const images = new Map(
    dataset.entries.map((entry) => [entry.id, { id: entry.id, queries: [] as string[], judged: 0 }]),
  );
  const queries = dataset.cases.map((item) => {
    const positives: string[] = [];
    let judged = 0;
    let partial = 0;
    for (const label of item.judgments) {
      if (label.relevance !== 'unknown') {
        judged++;
        images.get(label.id)!.judged++;
      }
      if (label.relevance === 'positive') {
        positives.push(label.id);
        images.get(label.id)!.queries.push(item.id);
      }
      if (label.relevance === 'partial') partial++;
    }
    const unknown = dataset.entries.length - judged;
    return {
      id: item.id,
      query: item.query,
      group: item.group,
      split: item.split,
      images: positives,
      knownRelevant: positives.length,
      partial,
      unknown,
      knownCardinality: cardinality(positives.length),
      complete: unknown === 0,
      confirmedEmpty: item.expected === 'no_result' && unknown === 0 && partial === 0 && positives.length === 0,
    };
  });
  const imageRows = [...images.values()].map((item) => ({
    ...item,
    knownRelevant: item.queries.length,
    knownCardinality: cardinality(item.queries.length),
    complete: item.judged === dataset.cases.length,
    unknown: dataset.cases.length - item.judged,
  }));
  const queryMap = new Map(queries.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const components: { shape: string; queries: string[]; images: string[] }[] = [];
  for (const item of queries) {
    if (!item.images.length || visited.has(item.id)) continue;
    const queryIds = new Set<string>();
    const imageIds = new Set<string>();
    const pending = [item.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      queryIds.add(id);
      for (const imageId of queryMap.get(id)!.images) {
        if (imageIds.has(imageId)) continue;
        imageIds.add(imageId);
        pending.push(...images.get(imageId)!.queries);
      }
    }
    components.push({
      shape: `${cardinality(queryIds.size)}_to_${cardinality(imageIds.size)}`,
      queries: [...queryIds],
      images: [...imageIds],
    });
  }
  const counts = (items: { knownCardinality: string }[]) =>
    Object.fromEntries(
      ['zero', 'one', 'many'].map((key) => [key, items.filter((item) => item.knownCardinality === key).length]),
    );
  return {
    schema: 1,
    datasetId: digest(dataset),
    basis: 'labeled-positive-edges',
    provisional: dataset.cases.some((item) => item.judgments.some((label) => label.origin !== 'human')),
    summary: {
      images: imageRows.length,
      queries: queries.length,
      groups: new Set(queries.map((item) => item.group)).size,
      queryCardinality: counts(queries),
      imageCardinality: counts(imageRows),
      confirmedEmptyQueries: queries.filter((item) => item.confirmedEmpty).length,
      incompleteQueries: queries.filter((item) => !item.complete).length,
      shapes: Object.fromEntries(
        ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'].map((shape) => [
          shape,
          components.filter((item) => item.shape === shape).length,
        ]),
      ),
    },
    queries,
    images: imageRows,
    components,
    limitations: [
      'COUNTS_ARE_LOWER_BOUNDS_WHEN_INCOMPLETE',
      'ZERO_IMAGE_EDGES_DO_NOT_PROVE_UNSEARCHABLE',
      'COMPONENT_SHAPE_DOES_NOT_IMPLY_ALL_TO_ALL_RELEVANCE',
      'RETRIEVAL_MISSES_REQUIRE_SEPARATE_RANKING_REPORT',
    ],
  };
}

function cardinality(count: number) {
  return count === 0 ? 'zero' : count === 1 ? 'one' : 'many';
}

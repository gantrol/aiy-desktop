import type { TrainingSnapshot } from '@/shared/model-training';
import { snapshotIdentity } from '@/main/model-training/dataset';
import { digest } from '@/main/model-training/io';

/** Annotation candidates only: similarity never creates a relevance judgment. CLI-only, bounded by snapshot schema. */
export function suggestRelations(snapshot: TrainingSnapshot, limit = 5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('LIMIT_MUST_BE_1_TO_20');
  const queries = snapshot.dataset.cases.filter((item) => item.split !== 'acceptance');
  const entries = snapshot.dataset.entries;
  const labels = new Map(queries.map((item) => [item.id, new Map(item.judgments.map((label) => [label.id, label]))]));
  const scores = queries.map((query) =>
    entries.map((entry) => {
      const left = snapshot.queries[query.id];
      const right = snapshot.images[entry.id];
      let score = 0;
      for (let dimension = 0; dimension < left.length; dimension++) score += left[dimension] * right[dimension];
      return score;
    }),
  );
  const pairs = new Map<string, { queryId: string; imageId: string; score: number; reasons: string[] }>();
  const add = (queryIndex: number, imageIndex: number, reason: string) => {
    const queryId = queries[queryIndex].id;
    const imageId = entries[imageIndex].id;
    const key = JSON.stringify([queryId, imageId]);
    const pair = pairs.get(key) ?? { queryId, imageId, score: scores[queryIndex][imageIndex], reasons: [] };
    if (!pair.reasons.includes(reason)) pair.reasons.push(reason);
    pairs.set(key, pair);
  };
  const unknown = (queryIndex: number, imageIndex: number) => {
    const label = labels.get(queries[queryIndex].id)!.get(entries[imageIndex].id);
    return !label || label.relevance === 'unknown';
  };
  // Spread samples expose model blind spots; they are not presumed negatives.
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    const available = entries.map((_, index) => index).filter((index) => unknown(queryIndex, index));
    const nearest = [...available].sort((a, b) => scores[queryIndex][b] - scores[queryIndex][a] || a - b);
    for (const imageIndex of nearest.slice(0, limit)) add(queryIndex, imageIndex, 'query_neighbor');
    const spread = available
      .filter((index) => !nearest.slice(0, limit).includes(index))
      .map((index) => ({ index, order: digest([queries[queryIndex].id, entries[index].id]) }))
      .sort((a, b) => a.order.localeCompare(b.order));
    for (const item of spread.slice(0, 2)) add(queryIndex, item.index, 'query_spread');
  }
  for (let imageIndex = 0; imageIndex < entries.length; imageIndex++) {
    const available = queries.map((_, index) => index).filter((index) => unknown(index, imageIndex));
    const nearest = [...available].sort((a, b) => scores[b][imageIndex] - scores[a][imageIndex] || a - b);
    const groups = new Set<string>();
    for (const queryIndex of nearest) {
      if (groups.has(queries[queryIndex].group)) continue;
      groups.add(queries[queryIndex].group);
      add(queryIndex, imageIndex, 'image_neighbor');
      if (groups.size >= limit) break;
    }
  }
  const pending = [...pairs.values()].map((item) => ({
    ...item,
    status: 'pending' as const,
    previousJudgment: labels.get(item.queryId)!.get(item.imageId) ?? null,
  }));
  return {
    schema: 1,
    datasetId: snapshot.datasetId,
    snapshotId: snapshotIdentity(snapshot),
    basis: 'frozen-vector-cosine-candidate-mining',
    summary: {
      images: entries.length,
      queries: queries.length,
      groups: new Set(queries.map((item) => item.group)).size,
      pendingPairs: pending.length,
      byReason: Object.fromEntries(
        ['query_neighbor', 'image_neighbor', 'query_spread'].map((reason) => [
          reason,
          pending.filter((item) => item.reasons.includes(reason)).length,
        ]),
      ),
    },
    queries: queries.map((item) => ({
      id: item.id,
      query: item.query,
      group: item.group,
      split: item.split,
      existingJudgments: item.judgments,
      candidates: pending.filter((pair) => pair.queryId === item.id).map((pair) => pair.imageId),
    })),
    images: entries.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      existingPositiveQueries: queries
        .filter((query) => labels.get(query.id)!.get(entry.id)?.relevance === 'positive')
        .map((query) => query.id),
      candidates: pending.filter((pair) => pair.imageId === entry.id).map((pair) => pair.queryId),
    })),
    pending,
    limitations: [
      'SIMILARITY_IS_NOT_A_LABEL',
      'ACCEPTANCE_QUERIES_EXCLUDED',
      'EXISTING_LABELS_UNCHANGED',
      'MISSING_PAIRS_REMAIN_UNKNOWN',
      'NEW_QUERY_WORDING_REQUIRES_IMAGE_REVIEW',
    ],
  };
}

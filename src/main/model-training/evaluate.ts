import { ImageVectorCache } from '@/main/image-search/vector-cache';
import {
  applyQueryAdapter,
  type QueryAdapter,
  type TrainingSnapshot,
  type TrainingCase,
} from '@/shared/model-training';
import { digest } from '@/main/model-training/io';
import { snapshotIdentity } from '@/main/model-training/dataset';

function average(values: (number | null)[]) {
  const finite = values.filter((value): value is number => value !== null);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function evaluateSnapshot(
  snapshot: TrainingSnapshot,
  adapter: QueryAdapter | null,
  split: TrainingCase['split'],
  k = 5,
) {
  if (
    adapter &&
    (adapter.modelDigest !== snapshot.modelDigest ||
      adapter.datasetId !== snapshot.datasetId ||
      adapter.snapshotId !== snapshotIdentity(snapshot))
  )
    throw new Error('CANDIDATE_CONTRACT_MISMATCH');
  const selected = snapshot.dataset.cases.filter((item) => item.split === split);
  if (!selected.length) throw new Error('EMPTY_EVALUATION_SPLIT');
  const cache = new ImageVectorCache(':memory:', snapshot.runtimeFingerprint);
  try {
    cache.startSync();
    for (let offset = 0; offset < snapshot.dataset.entries.length; offset += 128) {
      cache.synchronize(
        snapshot.dataset.entries.slice(offset, offset + 128).map((entry) => ({
          id: entry.id,
          hash: entry.revision,
          title: entry.title,
          titleKind: 'NAME' as const,
          createdAt: '',
          aliases: entry.title ? [entry.title] : [],
          bytes: 1,
          mime: entry.mime,
        })),
      );
    }
    cache.finishSync();
    for (const entry of snapshot.dataset.entries)
      cache.save(entry.id, entry.revision, Float32Array.from(snapshot.images[entry.id]));
    const rows = selected.map((item) => {
      const started = performance.now();
      const query = applyQueryAdapter(Float32Array.from(snapshot.queries[item.id]), adapter);
      const ranked = [];
      for (let offset = 0; offset < snapshot.dataset.entries.length; offset += 30) {
        const page = cache.search(item.query, query, offset, () => {});
        ranked.push(...page.items.slice(0, 30));
        if (page.items.length <= 30) break;
      }
      const rankMs = performance.now() - started;
      const labels = new Map(item.judgments.map((judgment) => [judgment.id, judgment.relevance]));
      const positiveCount = item.judgments.filter((judgment) => judgment.relevance === 'positive').length;
      const first = ranked.findIndex((result) => labels.get(result.id) === 'positive');
      const top = ranked.slice(0, k);
      return {
        id: item.id,
        group: item.group,
        expected: item.expected,
        returned: ranked.length,
        rankMs,
        reciprocalRankLabeled: positiveCount ? (first < 0 ? 0 : 1 / (first + 1)) : null,
        recallLabeled: positiveCount
          ? top.filter((result) => labels.get(result.id) === 'positive').length / positiveCount
          : null,
        errors: top.filter((result) => labels.get(result.id) === 'negative').length,
        confidentErrors: top.filter((result) => !result.borderline && labels.get(result.id) === 'negative').length,
        partial: top.filter((result) => labels.get(result.id) === 'partial').length,
        unknown: top.filter((result) => !labels.has(result.id) || labels.get(result.id) === 'unknown').length,
        ranked: ranked.map((result) => ({
          id: result.id,
          score: result.score,
          borderline: result.borderline ?? false,
        })),
      };
    });
    const groups = [...new Set(rows.map((row) => row.group))];
    const mean = (field: 'reciprocalRankLabeled' | 'recallLabeled' | 'errors' | 'unknown' | 'rankMs') =>
      average(groups.map((group) => average(rows.filter((row) => row.group === group).map((row) => row[field]))));
    return {
      schema: 1,
      datasetId: snapshot.datasetId,
      modelDigest: snapshot.modelDigest,
      candidateId: adapter ? digest(adapter) : 'baseline',
      producer: 'production-encoder-and-image-ranking',
      scope: 'selected-known-image-corpus',
      split,
      k,
      cases: rows.length,
      groups: groups.length,
      provisional: selected.some((item) => item.judgments.some((judgment) => judgment.origin !== 'human')),
      mean: {
        reciprocalRankLabeled: mean('reciprocalRankLabeled'),
        recallLabeled: mean('recallLabeled'),
        errors: mean('errors'),
        unknown: mean('unknown'),
        rankMs: mean('rankMs'),
      },
      rows,
      deploymentApproved: false,
      limitations: [
        'SELECTED_CORPUS_ONLY',
        'VISUAL_SEMANTIC_ONLY',
        'NO_OCR_OR_MIXED_LIST_ACCEPTANCE',
        'NO_SIGNIFICANCE_CLAIM',
      ],
    };
  } finally {
    cache.close();
  }
}

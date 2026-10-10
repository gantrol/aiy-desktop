import { trainingDatasetSchema, trainingSnapshotSchema, type TrainingSnapshot } from '@/shared/model-training';
import { digest } from '@/main/model-training/io';

export function validateDataset(raw: unknown) {
  const dataset = trainingDatasetSchema.parse(raw);
  const entries = new Map(dataset.entries.map((entry) => [entry.id, entry]));
  if (entries.size !== dataset.entries.length) throw new Error('DUPLICATE_ENTRY');
  const cases = new Set<string>();
  const groups = new Map<string, string>();
  const queries = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const item of dataset.cases) {
    if (cases.has(item.id)) throw new Error('DUPLICATE_CASE');
    cases.add(item.id);
    const query = item.query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (queries.has(query) && queries.get(query) !== item.group) throw new Error('QUERY_GROUP_CONFLICT');
    queries.set(query, item.group);
    if (groups.has(item.group) && groups.get(item.group) !== item.split) throw new Error('QUERY_SPLIT_LEAK');
    groups.set(item.group, item.split);
    const judgments = new Set<string>();
    const sourceLabels = new Map<string, Set<string>>();
    for (const judgment of item.judgments) {
      const entry = entries.get(judgment.id);
      if (!entry || judgments.has(judgment.id)) throw new Error('INVALID_JUDGMENT');
      judgments.add(judgment.id);
      const labels = sourceLabels.get(entry.sourceGroup) ?? new Set<string>();
      labels.add(judgment.relevance);
      sourceLabels.set(entry.sourceGroup, labels);
      if (labels.has('positive') && labels.has('negative')) throw new Error('SOURCE_LABEL_CONFLICT');
      if (dataset.protocol === 'new_content') {
        if (sources.has(entry.sourceGroup) && sources.get(entry.sourceGroup) !== item.split)
          throw new Error('SOURCE_SPLIT_LEAK');
        sources.set(entry.sourceGroup, item.split);
      }
    }
    const positive = item.judgments.some((judgment) => judgment.relevance === 'positive');
    const useful = item.judgments.some((judgment) => ['positive', 'partial'].includes(judgment.relevance));
    if (item.expected === 'has_result' && !positive) throw new Error('POSITIVE_REQUIRED');
    if (item.expected === 'no_result' && useful) throw new Error('NO_RESULT_CONFLICT');
    if (
      item.expected === 'no_result' &&
      (item.judgments.length !== entries.size || item.judgments.some((judgment) => judgment.relevance !== 'negative'))
    )
      throw new Error('NO_RESULT_REQUIRES_COMPLETE_JUDGMENTS');
  }
  // This first recipe shares one fixed matrix; a true new-content partition needs separate matrices.
  if (dataset.protocol !== 'known_corpus') throw new Error('NEW_CONTENT_RECIPE_NOT_IMPLEMENTED');
  return dataset;
}
export function validateSnapshot(raw: unknown) {
  const snapshot = trainingSnapshotSchema.parse(raw);
  validateDataset(snapshot.dataset);
  if (digest(snapshot.dataset) !== snapshot.datasetId) throw new Error('DATASET_DIGEST_MISMATCH');
  if (digest(snapshot.modelFiles) !== snapshot.modelDigest) throw new Error('MODEL_DIGEST_MISMATCH');
  for (const item of snapshot.dataset.entries) if (!snapshot.images[item.id]) throw new Error('MISSING_IMAGE_VECTOR');
  for (const item of snapshot.dataset.cases) if (!snapshot.queries[item.id]) throw new Error('MISSING_QUERY_VECTOR');
  for (const vector of [...Object.values(snapshot.images), ...Object.values(snapshot.queries)]) {
    const norm = vector.reduce((sum, value) => sum + value * value, 0);
    if (Math.abs(norm - 1) > 0.001) throw new Error('VECTOR_NOT_NORMALIZED');
  }
  return snapshot;
}

/** Bind candidates to the actual frozen Q8 outputs, not only labels and model filenames. */
export function snapshotIdentity(snapshot: TrainingSnapshot) {
  return digest({
    datasetId: snapshot.datasetId,
    modelDigest: snapshot.modelDigest,
    encoderVersion: snapshot.encoderVersion,
    device: snapshot.device,
    images: snapshot.images,
    queries: snapshot.queries,
  });
}

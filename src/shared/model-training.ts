import { z } from 'zod';

export const embeddingDimension = 768;
const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const vector = z.array(z.number().finite()).length(embeddingDimension);
export const trainingEntrySchema = z
  .object({
    id: identity,
    revision: hash,
    sourceGroup: identity,
    title: z.string().max(1000),
    path: z.string().min(1),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  })
  .strict();
export const trainingCaseSchema = z
  .object({
    id: identity,
    query: z.string().trim().min(1).max(200),
    intent: z.string().trim().min(1).max(2000),
    group: identity,
    split: z.enum(['train', 'validation', 'acceptance']),
    expected: z.enum(['has_result', 'no_result', 'unknown']),
    judgments: z
      .array(
        z
          .object({
            id: identity,
            relevance: z.enum(['positive', 'partial', 'negative', 'unknown']),
            origin: z.enum(['human', 'assistant_visual', 'dictionary_link']),
            assessor: identity,
            note: z.string().max(2000),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();
export const trainingDatasetSchema = z
  .object({
    schema: z.literal(1),
    protocol: z.enum(['known_corpus', 'new_content']),
    entries: z.array(trainingEntrySchema).min(2).max(256),
    cases: z.array(trainingCaseSchema).min(1).max(512),
  })
  .strict();
export type TrainingDataset = z.infer<typeof trainingDatasetSchema>;
export type TrainingCase = z.infer<typeof trainingCaseSchema>;
export const trainingSnapshotSchema = z
  .object({
    schema: z.literal(1),
    datasetId: hash,
    dataset: trainingDatasetSchema,
    modelDigest: hash,
    runtimeFingerprint: hash,
    encoderVersion: z.literal('q8-image-query-768-v1'),
    modelFiles: z.record(z.string(), hash),
    device: z.enum(['CPU', 'GPU']),
    createdAt: z.string().datetime(),
    prepareMs: z.number().nonnegative(),
    images: z.record(identity, vector),
    queries: z.record(identity, vector),
    queryMs: z.record(identity, z.number().nonnegative()),
  })
  .strict();
export type TrainingSnapshot = z.infer<typeof trainingSnapshotSchema>;

export const queryAdapterSchema = z
  .object({
    schema: z.literal(1),
    kind: z.literal('query-residual-v1'),
    modelDigest: hash,
    datasetId: hash,
    snapshotId: hash,
    rank: z.number().int().min(1).max(32),
    down: z.array(vector).min(1).max(32),
    up: z.array(z.array(z.number().finite()).min(1).max(32)).length(embeddingDimension),
    provisional: z.boolean(),
    trainingSteps: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.down.length !== value.rank || value.up.some((row) => row.length !== value.rank))
      context.addIssue({ code: 'custom', message: 'ADAPTER_DIMENSION_MISMATCH' });
  });
export type QueryAdapter = z.infer<typeof queryAdapterSchema>;

/** Query-only post-processing. Corpus vectors and keyword ranking are untouched. */
export function applyQueryAdapter(input: Float32Array, adapter?: QueryAdapter | null) {
  if (!adapter) return input;
  if (input.length !== embeddingDimension) throw new Error('ADAPTER_DIMENSION_MISMATCH');
  const hidden = adapter.down.map((row) => row.reduce((sum, value, index) => sum + value * input[index], 0));
  const output = Float32Array.from(
    input,
    (value, index) => value + adapter.up[index].reduce((sum, weight, column) => sum + weight * hidden[column], 0),
  );
  const norm = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('INVALID_EMBEDDING');
  return output.map((value) => value / norm);
}

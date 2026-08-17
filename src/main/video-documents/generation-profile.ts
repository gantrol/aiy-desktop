import { z } from 'zod';

export const videoDocumentSegmentTypeSchema = z.enum([
  'CONCEPT',
  'PROCEDURE',
  'ARGUMENT',
  'NARRATIVE',
  'EVENT',
  'PERFORMANCE',
  'CONVERSATION',
  'EXPLORATION',
  'ORIGINAL_LED',
]);

export const videoDocumentProfileSchema = z.enum([
  'STUDY_NOTE',
  'STEP_GUIDE',
  'DECISION_BRIEF',
  'SPOILER_FREE_STORY_CARD',
  'EVENT_TIMELINE',
  'PERFORMANCE_COMPANION',
  'THEMATIC_RECORD',
  'FIELD_NOTES',
  'ORIGINAL_LED',
]);

export const videoDocumentClassificationConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

const semanticUnitKindSchema = z.enum([
  'GOAL',
  'PREREQUISITE',
  'PROBLEM',
  'INTUITION',
  'FORMALIZATION',
  'EXAMPLE',
  'CLAIM',
  'EVIDENCE',
  'CONDITION',
  'ACTION',
  'STATE_CHANGE',
  'FAILURE',
  'RECOVERY',
  'SUCCESS_STATE',
  'EVENT',
  'OBSERVATION',
  'OTHER',
]);

export const videoDocumentChapterPlanSchema = z
  .object({
    documentProfile: videoDocumentProfileSchema,
    chapters: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(200),
            startCueIndex: z.number().int().positive(),
            endCueIndex: z.number().int().positive(),
            segmentType: videoDocumentSegmentTypeSchema,
            classificationConfidence: videoDocumentClassificationConfidenceSchema,
            necessarySemanticUnits: z
              .array(
                z
                  .object({
                    kind: semanticUnitKindSchema,
                    summary: z.string().trim().min(1).max(500),
                    supportCueIndexes: z.array(z.number().int().positive()).min(1).max(24),
                  })
                  .strict(),
              )
              .min(1)
              .max(24),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();

export const videoDocumentDraftBatchSchema = z
  .object({
    documentProfile: videoDocumentProfileSchema,
    classificationConfidence: videoDocumentClassificationConfidenceSchema,
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(200),
            startTimestampMs: z.number().int().nonnegative(),
            endTimestampMs: z.number().int().nonnegative(),
            segmentType: videoDocumentSegmentTypeSchema,
            classificationConfidence: videoDocumentClassificationConfidenceSchema,
            paragraphs: z.array(z.string().trim().min(1).max(2_000)).max(8),
            steps: z.array(z.string().trim().min(1).max(1_000)).max(12),
            directQuoteCueIndexes: z.array(z.number().int().positive()).max(2),
            visualCandidateIds: z.array(z.string().min(1).max(200)).max(8),
            coveredSemanticUnitIds: z.array(z.string().min(1).max(200)).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

export type VideoDocumentChapterPlanCandidate = z.infer<typeof videoDocumentChapterPlanSchema>;
export type VideoDocumentDraftBatch = z.infer<typeof videoDocumentDraftBatchSchema>;
export type VideoDocumentDraftSection = VideoDocumentDraftBatch['sections'][number];
export type VideoDocumentSegmentType = z.infer<typeof videoDocumentSegmentTypeSchema>;
export type VideoDocumentProfile = z.infer<typeof videoDocumentProfileSchema>;
export type VideoDocumentClassificationConfidence = z.infer<typeof videoDocumentClassificationConfidenceSchema>;

const segmentTypes = videoDocumentSegmentTypeSchema.options;
const documentProfiles = videoDocumentProfileSchema.options;
const confidenceLevels = videoDocumentClassificationConfidenceSchema.options;
const semanticUnitKinds = semanticUnitKindSchema.options;

export const videoDocumentChapterPlanOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentProfile: { type: 'string', enum: documentProfiles },
    chapters: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          heading: { type: 'string', minLength: 1, maxLength: 200 },
          startCueIndex: { type: 'integer', minimum: 1 },
          endCueIndex: { type: 'integer', minimum: 1 },
          segmentType: { type: 'string', enum: segmentTypes },
          classificationConfidence: { type: 'string', enum: confidenceLevels },
          necessarySemanticUnits: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: semanticUnitKinds },
                summary: { type: 'string', minLength: 1, maxLength: 500 },
                supportCueIndexes: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 24,
                  items: { type: 'integer', minimum: 1 },
                },
              },
              required: ['kind', 'summary', 'supportCueIndexes'],
            },
          },
        },
        required: [
          'heading',
          'startCueIndex',
          'endCueIndex',
          'segmentType',
          'classificationConfidence',
          'necessarySemanticUnits',
        ],
      },
    },
  },
  required: ['documentProfile', 'chapters'],
} as const;

export const videoDocumentDraftBatchOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentProfile: { type: 'string', enum: documentProfiles },
    classificationConfidence: { type: 'string', enum: confidenceLevels },
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          heading: { type: 'string', minLength: 1, maxLength: 200 },
          startTimestampMs: { type: 'integer', minimum: 0 },
          endTimestampMs: { type: 'integer', minimum: 0 },
          segmentType: { type: 'string', enum: segmentTypes },
          classificationConfidence: { type: 'string', enum: confidenceLevels },
          paragraphs: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 2_000 } },
          steps: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
          directQuoteCueIndexes: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1 } },
          visualCandidateIds: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          coveredSemanticUnitIds: {
            type: 'array',
            maxItems: 24,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        required: [
          'heading',
          'startTimestampMs',
          'endTimestampMs',
          'segmentType',
          'classificationConfidence',
          'paragraphs',
          'steps',
          'directQuoteCueIndexes',
          'visualCandidateIds',
          'coveredSemanticUnitIds',
        ],
      },
    },
  },
  required: ['documentProfile', 'classificationConfidence', 'sections'],
} as const;

export function formatVideoDocumentTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

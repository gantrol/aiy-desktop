import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const dateTimeSchema = z.string().datetime({ offset: true });
const shortTextSchema = z.string().max(500);

export const evaluationCaseKindSchema = z.enum(['MODEL_RESPONSE', 'MEDIA_CREATION', 'SOFTWARE_TASK']);
export const evaluationInputPartKindSchema = z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE']);
export const evaluationTargetTypeSchema = z.enum(['MODEL_API', 'CHAT_IMPORT', 'AGENT_RUNTIME']);
export const evaluationPreprocessingSchema = z.enum(['NATIVE', 'TRANSCRIPT', 'KEY_FRAMES']);
export const evaluationCriterionPhaseSchema = z.enum(['GENERAL', 'IDEATION', 'DESIGN', 'DEVELOPMENT', 'ITERATION']);

const inputPartRecordShape = {
  id: idSchema,
  label: shortTextSchema,
  sortOrder: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};

export const evaluationTextInputPartSchema = z
  .object({
    ...inputPartRecordShape,
    kind: z.literal('TEXT'),
    text: z.string().max(200_000),
  })
  .strict();

const mediaInputPartRecordShape = {
  ...inputPartRecordShape,
  assetId: idSchema,
  mimeType: z.string().trim().min(1).max(500),
  preprocessing: evaluationPreprocessingSchema,
  timeRange: z
    .object({
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
    })
    .strict()
    .nullable(),
};

function mediaInputPartSchema(kind: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE') {
  return z
    .object({
      ...mediaInputPartRecordShape,
      kind: z.literal(kind),
    })
    .strict()
    .superRefine((part, context) => {
      if (part.timeRange && part.timeRange.endMs <= part.timeRange.startMs) {
        context.addIssue({
          code: 'custom',
          path: ['timeRange', 'endMs'],
          message: 'The media time range must end after it starts',
        });
      }
    });
}

export const evaluationImageInputPartSchema = mediaInputPartSchema('IMAGE');
export const evaluationAudioInputPartSchema = mediaInputPartSchema('AUDIO');
export const evaluationVideoInputPartSchema = mediaInputPartSchema('VIDEO');
export const evaluationFileInputPartSchema = mediaInputPartSchema('FILE');

export const evaluationInputPartSchema = z.union([
  evaluationTextInputPartSchema,
  evaluationImageInputPartSchema,
  evaluationAudioInputPartSchema,
  evaluationVideoInputPartSchema,
  evaluationFileInputPartSchema,
]);

export const evaluationCriterionSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2_000),
    weight: z.number().nonnegative().max(100),
    phase: evaluationCriterionPhaseSchema.default('GENERAL'),
    isGate: z.boolean().default(false),
  })
  .strict();

export const evaluationCaseSchema = z
  .object({
    id: idSchema,
    kind: evaluationCaseKindSchema,
    title: z.string().trim().min(1).max(300),
    inputParts: z.array(evaluationInputPartSchema).min(1).max(50),
    expected: z.string().max(100_000),
    criteria: z.array(evaluationCriterionSchema).max(50),
    tags: z.array(z.string().trim().min(1).max(100)).max(50),
  })
  .strict()
  .superRefine((evaluationCase, context) => {
    const partIds = new Set<string>();
    for (const [index, part] of evaluationCase.inputParts.entries()) {
      if (partIds.has(part.id)) {
        context.addIssue({
          code: 'custom',
          path: ['inputParts', index, 'id'],
          message: 'Input part IDs must be unique within a case',
        });
      }
      partIds.add(part.id);
    }
    const criterionIds = new Set<string>();
    for (const [index, criterion] of evaluationCase.criteria.entries()) {
      if (criterionIds.has(criterion.id)) {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'id'],
          message: 'Criterion IDs must be unique within a case',
        });
      }
      criterionIds.add(criterion.id);
    }
    if (new Set(evaluationCase.tags).size !== evaluationCase.tags.length) {
      context.addIssue({ code: 'custom', path: ['tags'], message: 'Case tags must be unique' });
    }
  });

export const evaluationTargetConditionSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(200),
    type: evaluationTargetTypeSchema,
    providerKey: z.string().trim().min(1).max(200).nullable(),
    modelKey: z.string().trim().min(1).max(200).nullable(),
    systemPrompt: z.string().max(100_000),
    preferenceProfile: z.string().max(20_000),
    temperature: z.number().min(0).max(2).nullable(),
    enabled: z.boolean(),
  })
  .strict();

export const evaluationSuiteContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(300),
    defaultRepeatCount: z.number().int().min(1).max(20),
    cases: z.array(evaluationCaseSchema).max(1_000),
    conditions: z.array(evaluationTargetConditionSchema).max(100),
  })
  .strict()
  .superRefine((content, context) => {
    const caseIds = new Set<string>();
    for (const [index, evaluationCase] of content.cases.entries()) {
      if (caseIds.has(evaluationCase.id)) {
        context.addIssue({
          code: 'custom',
          path: ['cases', index, 'id'],
          message: 'Case IDs must be unique within an evaluation suite',
        });
      }
      caseIds.add(evaluationCase.id);
    }
    const conditionIds = new Set<string>();
    for (const [index, condition] of content.conditions.entries()) {
      if (conditionIds.has(condition.id)) {
        context.addIssue({
          code: 'custom',
          path: ['conditions', index, 'id'],
          message: 'Condition IDs must be unique within an evaluation suite',
        });
      }
      conditionIds.add(condition.id);
    }
  });

export const evaluationSuiteSchema = z
  .object({
    id: idSchema,
    albumId: idSchema.nullable(),
    content: evaluationSuiteContentSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    revisionId: idSchema,
    revisionNo: z.number().int().positive(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict();

export const evaluationSuiteCreateInputSchema = z
  .object({
    albumId: idSchema.nullable(),
    locale: z.enum(['zh', 'en']),
  })
  .strict();

export const evaluationSuiteGetInputSchema = z.object({ id: idSchema }).strict();

export const evaluationSuiteSaveInputSchema = z
  .object({
    id: idSchema,
    content: evaluationSuiteContentSchema,
  })
  .strict();

export const evaluationSuiteListResultSchema = z.array(evaluationSuiteSchema).max(100_000);
export const evaluationSuiteCreateResultSchema = evaluationSuiteSchema;
export const evaluationSuiteGetResultSchema = evaluationSuiteSchema;
export const evaluationSuiteSaveResultSchema = evaluationSuiteSchema;

export type EvaluationCaseKind = z.infer<typeof evaluationCaseKindSchema>;
export type EvaluationInputPartKind = z.infer<typeof evaluationInputPartKindSchema>;
export type EvaluationTargetType = z.infer<typeof evaluationTargetTypeSchema>;
export type EvaluationPreprocessing = z.infer<typeof evaluationPreprocessingSchema>;
export type EvaluationCriterionPhase = z.infer<typeof evaluationCriterionPhaseSchema>;
export type EvaluationInputPart = z.infer<typeof evaluationInputPartSchema>;
export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>;
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export type EvaluationTargetCondition = z.infer<typeof evaluationTargetConditionSchema>;
export type EvaluationSuiteContentInput = z.infer<typeof evaluationSuiteContentSchema>;
export type EvaluationSuiteDto = z.infer<typeof evaluationSuiteSchema>;
export type EvaluationSuiteCreateInput = z.infer<typeof evaluationSuiteCreateInputSchema>;
export type EvaluationSuiteGetInput = z.infer<typeof evaluationSuiteGetInputSchema>;
export type EvaluationSuiteSaveInput = z.infer<typeof evaluationSuiteSaveInputSchema>;

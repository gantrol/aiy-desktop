import { z } from 'zod';
import { developmentHandoffPacketSchema } from '@/shared/contracts/development-handoff';
import { contentAgentSchema, contentSourceSchema } from '@/shared/contracts/content-provenance';

const id = z.string().min(1).max(200);
const text = z.string().trim().max(8000);
export const workItemKinds = ['REQUIREMENT', 'BUG', 'RESEARCH'] as const;
export const workItemStates = ['DRAFT', 'TRIAGE', 'BACKLOG', 'READY', 'IN_PROGRESS', 'VERIFY', 'CLOSED'] as const;
export const workResolutions = ['COMPLETED', 'DUPLICATE', 'NOT_PLANNED', 'NOT_REPRODUCIBLE'] as const;
export const workAttemptStates = ['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'] as const;
export const workPhases = ['expression', 'trial', 'confirmation', 'development', 'acceptance', 'maintenance'] as const;
export const workErrorCodes = [
  'disabled',
  'spaceChanged',
  'conflict',
  'invalidInput',
  'sourceUnavailable',
  'missingItem',
  'missingTask',
  'missingAttempt',
  'invalidTransition',
  'acceptanceRequired',
  'evidenceRequired',
  'limit',
  'storageUnavailable',
] as const;
export type WorkErrorCode = (typeof workErrorCodes)[number];
export const workItemFieldsSchema = z
  .object({
    kind: z.enum(workItemKinds),
    state: z.enum(workItemStates),
    owner: z.string().trim().max(120),
    priority: z.enum(['NONE', 'HIGH', 'NORMAL', 'LOW']),
    acceptance: text,
    enabled: z.boolean(),
    resolution: z.enum(workResolutions).nullable(),
    duplicateOf: id.nullable(),
    evidence: text,
  })
  .strict();
export const workItemPatchSchema = workItemFieldsSchema.partial().refine((fields) => Object.keys(fields).length > 0);
export const workItemSchema = workItemFieldsSchema
  .extend({
    id,
    descriptionFormId: id,
    articleId: id,
    revision: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkItemFields = z.infer<typeof workItemFieldsSchema>;
export const workInputRevisionSchema = z
  .object({
    itemId: id,
    itemRevision: z.number().int().positive(),
    articleId: id,
    articleRevisionId: id,
    title: z.string().max(1000),
  })
  .strict();
export const workTaskSchema = z
  .object({
    id: z.string().uuid(),
    objective: text.min(1),
    executor: z.string().trim().min(1).max(120),
    phase: z.enum(workPhases),
    inputs: z.array(workInputRevisionSchema).min(1).max(8),
    packet: developmentHandoffPacketSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const workTaskSummarySchema = workTaskSchema.omit({ packet: true });
export type WorkTask = z.infer<typeof workTaskSchema>;
export type WorkTaskSummary = z.infer<typeof workTaskSummarySchema>;
export const workAttemptSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    executor: z.string().trim().min(1).max(120),
    state: z.enum(workAttemptStates),
    result: text,
    reference: z.string().trim().max(2000),
    provenance: z.literal('MANUAL'),
    recordedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkAttempt = z.infer<typeof workAttemptSchema>;
// Retrospective reports have no fabricated delegation or historical input snapshot.
export const workExecutionFieldsSchema = z
  .object({
    externalId: id,
    executor: contentAgentSchema,
    recorder: contentAgentSchema,
    title: z.string().trim().min(1).max(1000),
    phase: z.enum(workPhases),
    state: z.enum(workAttemptStates),
    result: text.min(1),
    reference: contentSourceSchema.shape.url,
    itemIds: z.array(id).max(8),
    linkNote: text,
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    sourceUpdatedAt: z.string().datetime(),
  })
  .strict();
export const workExecutionSchema = workExecutionFieldsSchema
  .extend({
    id: z.string().uuid(),
    recordedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkExecution = z.infer<typeof workExecutionSchema>;
export const workHistorySchema = z
  .object({
    requestId: z.string().uuid(),
    digest: z.string().length(64),
    action: z.enum([
      'track',
      'trackBatch',
      'updateItem',
      'updateItems',
      'createTask',
      'assignTask',
      'recordAttempt',
      'updateAttempt',
      'recordExecution',
    ]),
    targetId: id,
    relatedItemIds: z.array(id).max(100).optional(),
    actor: z.enum(['USER', 'CLI']),
    note: text,
    before: z.string().max(240000),
    after: z.string().max(24000),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const workStateSchema = z
  .object({
    version: z.literal(1),
    spaceId: id,
    revision: z.number().int().nonnegative(),
    items: z.array(workItemSchema).max(500),
    tasks: z.array(workTaskSchema).max(1000),
    attempts: z.array(workAttemptSchema).max(3000),
    executions: z.array(workExecutionSchema).max(3000).default([]),
    history: z.array(workHistorySchema).max(5000),
  })
  .strict();
export type WorkState = z.infer<typeof workStateSchema>;
export const workSnapshotSchema = workStateSchema.extend({ tasks: z.array(workTaskSummarySchema).max(1000) });
export type WorkSnapshot = z.infer<typeof workSnapshotSchema>;
export const workScopeSchema = z.object({ spaceId: id }).strict();
const mutation = { spaceId: id, revision: z.number().int().nonnegative(), requestId: z.string().uuid(), note: text };
export const workMutationSchema = z.discriminatedUnion('action', [
  workExecutionFieldsSchema.extend({ ...mutation, action: z.literal('recordExecution') }).strict(),
  z
    .object({
      ...mutation,
      action: z.literal('trackBatch'),
      albumId: id,
      entries: z
        .array(z.object({ creationItemId: id, descriptionFormId: id }).strict())
        .min(1)
        .max(100),
      kind: z.enum(workItemKinds),
      owner: z.string().trim().max(120),
      initialState: z.enum(['DRAFT', 'TRIAGE', 'BACKLOG']).optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal('track'),
      creationItemId: id,
      descriptionFormId: id,
      kind: z.enum(workItemKinds),
      owner: z.string().trim().max(120),
    })
    .strict(),
  z.object({ ...mutation, action: z.literal('updateItem'), itemId: id, fields: workItemPatchSchema }).strict(),
  z
    .object({
      ...mutation,
      action: z.literal('updateItems'),
      itemIds: z.array(id).min(1).max(100),
      fields: workItemFieldsSchema
        .pick({ kind: true, owner: true, priority: true })
        .partial()
        .refine((fields) => Object.keys(fields).length > 0),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal('createTask'),
      itemIds: z.array(id).min(1).max(8),
      objective: text.min(1),
      executor: z.string().trim().min(1).max(120),
      phase: z.enum(workPhases),
      constraints: text,
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal('assignTask'),
      taskId: z.string().uuid(),
      executor: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal('recordAttempt'),
      taskId: z.string().uuid(),
      state: z.enum(workAttemptStates),
      result: text,
      reference: z.string().trim().max(2000),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal('updateAttempt'),
      attemptId: z.string().uuid(),
      state: z.enum(workAttemptStates),
      result: text,
      reference: z.string().trim().max(2000),
    })
    .strict(),
]);
export type WorkMutation = z.infer<typeof workMutationSchema>;
export type WorkCommand = WorkMutation extends infer T
  ? T extends WorkMutation
    ? Omit<T, 'spaceId' | 'revision' | 'requestId'>
    : never
  : never;
export const workHandoffInputSchema = workScopeSchema.extend({ taskId: z.string().uuid() }).strict();
export function workResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), code: z.enum(workErrorCodes) }).strict(),
  ]);
}
export type WorkResult<T> = { ok: true; value: T } | { ok: false; code: WorkErrorCode };
export interface WorkTrackingApi {
  read(input: z.infer<typeof workScopeSchema>): Promise<WorkResult<WorkSnapshot>>;
  mutate(input: WorkMutation): Promise<WorkResult<WorkSnapshot>>;
  handoff(input: z.infer<typeof workHandoffInputSchema>): Promise<WorkResult<string>>;
}

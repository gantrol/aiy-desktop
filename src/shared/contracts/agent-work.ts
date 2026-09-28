import { z } from 'zod';
import { contentProvenanceSchema } from '@/shared/contracts/content-provenance';
import {
  workItemSchema,
  workMutationSchema,
  workScopeSchema,
  workSnapshotSchema,
} from '@/shared/contracts/work-tracking';

const id = z.string().min(1).max(200);
export const agentWorkReadSchema = workScopeSchema.extend({ protocolVersion: z.literal(1) }).strict();
export const agentWorkReadResultSchema = workSnapshotSchema;
export const agentWorkListSchema = workScopeSchema
  .extend({
    protocolVersion: z.literal(1),
    albumId: id.optional(),
    albumTitle: z.string().trim().min(1).max(1000).optional(),
    offset: z.number().int().nonnegative().max(1_000_000).default(0),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()
  .refine((input) => Boolean(input.albumId) !== Boolean(input.albumTitle), 'Specify albumId or albumTitle');
export type AgentWorkList = z.infer<typeof agentWorkListSchema>;
export const agentWorkListResultSchema = z
  .object({
    spaceId: id,
    album: z.object({ id, title: z.string() }).strict(),
    revision: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    rows: z
      .array(
        z
          .object({
            creationItemId: id,
            title: z.string(),
            descriptionFormId: id.nullable(),
            sources: z.array(
              z
                .object({
                  formId: id,
                  articleId: id,
                  title: z.string(),
                  provenance: contentProvenanceSchema.optional(),
                })
                .strict(),
            ),
            item: workItemSchema.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const agentWorkMutateSchema = z.object({ protocolVersion: z.literal(1), mutation: workMutationSchema }).strict();
export const agentWorkMutateResultSchema = workSnapshotSchema;
export const agentWorkCapabilities = {
  commands: ['work read', 'work list', 'work mutate'],
  maximumBatchSize: 100,
  requiresSpaceId: true,
  requiresExtension: 'com.aiy.work-tracking',
  initialStates: ['DRAFT', 'TRIAGE', 'BACKLOG'],
  mutations: [
    'track',
    'trackBatch',
    'updateItem',
    'updateItems',
    'createTask',
    'assignTask',
    'recordAttempt',
    'updateAttempt',
    'recordExecution',
  ],
} as const;

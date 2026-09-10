import { z } from 'zod';

const id = z.string().min(1).max(200);
const effortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const codexContentExecutionSchema = z
  .object({
    model: z.string().min(1).max(512).nullable().default(null),
    effort: effortSchema.nullable().default(null),
  })
  .strict();
export type CodexContentExecution = z.infer<typeof codexContentExecutionSchema>;
export const codexContentModelSchema = z.object({
  key: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: effortSchema.nullable(),
  supportedReasoningEfforts: z.array(effortSchema),
});
export type CodexContentModel = z.infer<typeof codexContentModelSchema>;
export const codexProjectTargetSchema = z
  .object({
    projectId: z.string().min(1).max(512).nullable(),
    workspace: z.string().max(32768),
    rootPaths: z.array(z.string().max(32768)).max(100).optional(),
    name: z.string().max(500),
  })
  .strict();
export type CodexProjectTarget = z.infer<typeof codexProjectTargetSchema>;
export const codexContentResultSchema = z
  .object({
    materialId: id,
    assetId: id,
    mediaUrl: z.string(),
    title: z.string(),
    openUrl: z.string(),
  })
  .strict();
export const codexContentTaskSchema = z
  .object({
    id,
    stashId: id,
    revisionId: id.nullable(),
    project: codexProjectTargetSchema,
    threadId: z.string().nullable(),
    turnId: z.string().nullable(),
    status: z.enum(['STARTING', 'RUNNING', 'COLLECTING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'COLLECTION_FAILED']),
    activity: z.enum(['thinking', 'working']).nullable().optional(),
    errorCode: z
      .enum([
        'execution',
        'interrupted',
        'collection',
        'permission',
        'project',
        'source',
        'emptyResponse',
        'timeout',
        'model',
        'clientUpgrade',
      ])
      .nullable(),
    errorDetail: z.string().max(2000).nullable().default(null),
    execution: codexContentExecutionSchema.default(() => codexContentExecutionSchema.parse({})),
    albumId: id.nullable(),
    outputCount: z.number().int().min(0).default(0),
    collectionRetryable: z.boolean().default(false),
    results: z.array(codexContentResultSchema).max(20),
    createdAt: z.string(),
  })
  .strict();
export type CodexContentTask = z.infer<typeof codexContentTaskSchema>;
export const codexContentStateSchema = z
  .object({
    enabled: z.boolean(),
    project: codexProjectTargetSchema.nullable(),
    albumId: id.nullable(),
    tasks: z.array(codexContentTaskSchema).max(1),
    execution: codexContentExecutionSchema.default(() => codexContentExecutionSchema.parse({})),
  })
  .strict();
export type CodexContentState = z.infer<typeof codexContentStateSchema>;
export const codexContentSettingsSchema = z
  .object({
    albumId: id.nullable(),
    albums: z.array(z.object({ id, title: z.string() })),
  })
  .strict();
export const codexContentCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('state'), stashId: id }).strict(),
  z.object({ kind: z.literal('projects'), fresh: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('models') }).strict(),
  z.object({ kind: z.literal('select-execution'), stashId: id, execution: codexContentExecutionSchema }).strict(),
  z.object({ kind: z.literal('select-project'), stashId: id, project: codexProjectTargetSchema }).strict(),
  z
    .object({
      kind: z.literal('start'),
      stashId: id,
      requestId: z.string().uuid(),
      expectedHash: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('stop'), stashId: id, taskId: id }).strict(),
  z.object({ kind: z.literal('collect'), stashId: id, taskId: id }).strict(),
  z.object({ kind: z.literal('open-task'), stashId: id, taskId: id }).strict(),
  z.object({ kind: z.literal('stop-and-open-task'), stashId: id, taskId: id }).strict(),
  z.object({ kind: z.literal('open-task-album'), stashId: id, taskId: id }).strict(),
  z.object({ kind: z.literal('open-source'), stashId: id }).strict(),
  z.object({ kind: z.literal('open-result'), stashId: id, taskId: id, materialId: id }).strict(),
  z.object({ kind: z.literal('quota') }).strict(),
  z.object({ kind: z.literal('settings') }).strict(),
  z.object({ kind: z.literal('select-album'), albumId: id }).strict(),
  z.object({ kind: z.literal('configure-quota'), limitId: z.string().max(512).nullable() }).strict(),
  z.object({ kind: z.literal('open-settings') }).strict(),
  z.object({ kind: z.literal('open-plugin') }).strict(),
  z.object({ kind: z.literal('open-album') }).strict(),
]);
export type CodexContentCommand = z.infer<typeof codexContentCommandSchema>;
export interface CodexContentApi {
  onChanged(callback: (event?: { stashId: string }) => void): () => void;
  command(input: CodexContentCommand): Promise<unknown>;
  state(stashId: string): Promise<CodexContentState>;
  projects(fresh?: boolean): Promise<CodexProjectTarget[]>;
}

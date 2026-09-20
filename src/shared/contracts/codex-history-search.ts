import { z } from 'zod';

const isoTimestampSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z.iso.date();
const threadIdSchema = z.string().trim().min(1).max(512);
export const codexHistoryThreadUsageInputSchema = z.object({ threadId: threadIdSchema }).strict();
const usageCount = z.number().int().nonnegative().safe();
export const codexHistoryThreadUsageModelSchema = z
  .object({
    model: z.string(),
    totalTokens: usageCount,
    inputTokens: usageCount,
    cachedInputTokens: usageCount,
    cacheWriteInputTokens: usageCount,
    outputTokens: usageCount,
    reasoningOutputTokens: usageCount,
    apiPricedTokens: usageCount,
    apiEquivalentUsd: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export const codexHistoryThreadUsageSchema = z
  .object({
    threadId: threadIdSchema,
    models: z.array(codexHistoryThreadUsageModelSchema),
    partial: z.boolean(),
  })
  .strict();
export type CodexHistoryThreadUsageInput = z.infer<typeof codexHistoryThreadUsageInputSchema>;
export type CodexHistoryThreadUsage = z.infer<typeof codexHistoryThreadUsageSchema>;
const projectIdSchema = z.string().trim().max(512);
const sectionIdSchema = z.string().trim().max(512);

export const codexHistoryArchiveFilterSchema = z.enum(['ALL', 'ACTIVE', 'ARCHIVED']);
export const codexHistoryRoleFilterSchema = z.enum(['ALL', 'USER', 'ASSISTANT']);
export const codexHistorySearchScopeSchema = z.enum(['ALL', 'THREADS', 'MESSAGES']);
export const codexHistoryMatchRoleSchema = z.enum(['THREAD', 'USER', 'ASSISTANT']);
export const codexHistoryThreadSourceSchema = z.enum(['USER', 'SUBAGENT', 'OTHER']);
export const codexHistoryIndexStatusSchema = z.enum(['EMPTY', 'INDEXING', 'READY', 'UNAVAILABLE', 'ERROR']);
export const codexHistoryThreadMessagesSourceSchema = z.enum(['PAGINATED', 'LEGACY']);

export const codexHistorySearchInputSchema = z
  .object({
    query: z.string().trim().max(500),
    archive: codexHistoryArchiveFilterSchema.default('ALL'),
    role: codexHistoryRoleFilterSchema.default('ALL'),
    scope: codexHistorySearchScopeSchema.optional(),
    includeSubagents: z.boolean().default(false),
    projectId: projectIdSchema.default(''),
    sectionId: sectionIdSchema.default(''),
    threadId: z.string().trim().max(512).default(''),
    workspace: z.string().trim().max(32_768).default(''),
    branch: z.string().trim().max(1_024).default(''),
    from: calendarDateSchema.nullable().default(null),
    to: calendarDateSchema.nullable().default(null),
    page: z.number().int().min(1).max(100_000),
    pageSize: z.number().int().min(10).max(50),
  })
  .strict()
  .refine(({ from, to }) => !from || !to || from <= to, { message: 'History date range must be ordered' });

export const codexHistoryFilterOptionsInputSchema = z
  .object({
    archive: codexHistoryArchiveFilterSchema.default('ALL'),
    includeSubagents: z.boolean().default(false),
    projectId: projectIdSchema.default(''),
    sectionId: sectionIdSchema.default(''),
    query: z.string().trim().max(500).default(''),
  })
  .strict();

export const codexHistoryRefreshInputSchema = z
  .object({
    rebuild: z.boolean().default(false),
  })
  .strict();

const messagePositionSchema = z
  .object({
    before: z.number().int().nonnegative().safe(),
    after: z.number().int().positive().safe(),
  })
  .strict()
  .refine(({ before, after }) => before < after);

export const codexHistoryThreadMessagesInputSchema = z
  .object({
    threadId: threadIdSchema,
    cursor: z.number().int().nonnegative().safe().nullable().default(null),
    pageSize: z.number().int().min(10).max(50),
    query: z.string().trim().max(500).optional(),
    role: codexHistoryRoleFilterSchema.optional(),
    direction: z.enum(['OLDER', 'NEWER']).optional(),
    anchor: messagePositionSchema.optional(),
  })
  .strict();

export const codexHistoryMessagePhaseSchema = z.enum(['COMMENTARY', 'FINAL', 'PLAN', 'RESULT']);
export const codexHistoryContextKindSchema = z.enum([
  'ATTACHMENTS',
  'BROWSER',
  'CHATGPT_REFERENCE',
  'ANNOTATIONS',
  'QUESTION_REPLY',
  'DELEGATION',
  'REALTIME',
  'AUTOMATION',
  'IDE',
  'SELECTION',
  'COMMAND',
  'SKILL',
  'MENTION',
  'WRITING',
  'OTHER',
]);
const codexHistoryContextItemSchema = z
  .object({
    label: z.string().max(500),
    text: z.string().max(1024 * 1024),
    role: z.enum(['USER', 'ASSISTANT']).nullable(),
    reference: z.string().max(32_768).nullable(),
  })
  .strict();
export const codexHistoryMessageBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('MARKDOWN'),
      text: z
        .string()
        .min(1)
        .max(1024 * 1024),
    })
    .strict(),
  z
    .object({
      type: z.literal('CONTEXT'),
      kind: codexHistoryContextKindSchema,
      title: z.string().max(500),
      text: z.string().max(1024 * 1024),
      reference: z.string().max(32_768).nullable(),
      items: z.array(codexHistoryContextItemSchema).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal('MEDIA'),
      kind: z.enum(['LOCAL_IMAGE', 'EMBEDDED_IMAGE', 'REMOTE_IMAGE', 'GENERATED_IMAGE']),
      source: z.string().max(32_768).nullable(),
      mediaUrl: z.string().max(65_536).nullable(),
      alt: z.string().max(2_000),
      status: z.enum(['GENERATING', 'COMPLETED', 'FAILED']).nullable(),
      prompt: z.string().max(1024 * 1024),
      error: z
        .string()
        .max(1024 * 1024)
        .nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('DIRECTIVE'),
      name: z.string().min(1).max(200),
      attributes: z.record(z.string().max(200), z.string().max(32_768)),
    })
    .strict(),
]);

export const codexHistoryMessageSchema = z
  .object({
    messageId: z.string().trim().min(1).max(512),
    role: z.enum(['USER', 'ASSISTANT']),
    turnId: z.string().trim().min(1).max(512).nullable(),
    phase: codexHistoryMessagePhaseSchema.nullable(),
    createdAt: isoTimestampSchema,
    position: messagePositionSchema.optional(),
    text: z.string().max(1024 * 1024),
    blocks: z.array(codexHistoryMessageBlockSchema).max(256),
  })
  .strict()
  .refine(({ text, blocks }) => Boolean(text.trim() || blocks.length), { message: 'History message is empty' });

export const codexHistoryThreadMessagesPageSchema = z
  .object({
    threadId: threadIdSchema,
    source: codexHistoryThreadMessagesSourceSchema,
    modelProvider: z.string().trim().min(1).max(200).nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
    messages: z.array(codexHistoryMessageSchema).max(50),
    nextCursor: z.number().int().nonnegative().safe().nullable(),
    newerCursor: z.number().int().nonnegative().safe().nullable().optional(),
    scanLimited: z.boolean(),
  })
  .strict();

export const codexHistoryIndexStateSchema = z
  .object({
    status: codexHistoryIndexStatusSchema,
    progress: z.number().int().min(0).max(100),
    indexedThreads: z.number().int().nonnegative().safe(),
    indexedMessages: z.number().int().nonnegative().safe(),
    updatedAt: isoTimestampSchema.nullable(),
    message: z.string().max(2_000).nullable(),
  })
  .strict();

export const codexHistorySearchResultSchema = z
  .object({
    threadId: threadIdSchema,
    title: z.string().min(1).max(500),
    titleAvailable: z.boolean(),
    projectId: projectIdSchema,
    projectName: z.string().max(500),
    sectionId: sectionIdSchema,
    sectionName: z.string().max(500),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    pinned: z.boolean(),
    workspace: z.string().max(32_768),
    branch: z.string().max(1_024),
    archived: z.boolean(),
    source: codexHistoryThreadSourceSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    role: codexHistoryMatchRoleSchema,
    snippet: z.string().max(1_200),
    matchCount: z.number().int().positive().safe(),
  })
  .strict();

export const codexHistoryProjectOptionSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(500),
    workspace: z.string().max(32_768),
    threadCount: z.number().int().nonnegative().safe(),
    sectionId: sectionIdSchema,
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();

export const codexHistoryThreadOptionSchema = z
  .object({
    threadId: threadIdSchema,
    title: z.string().trim().min(1).max(500),
    projectId: projectIdSchema,
    projectName: z.string().max(500),
    sectionId: sectionIdSchema,
    sectionName: z.string().max(500),
    sectionPosition: z.number().int().nonnegative().safe().nullable(),
    archived: z.boolean(),
    workspace: z.string().max(32_768),
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const codexHistorySectionOptionSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(500),
    threadCount: z.number().int().nonnegative().safe(),
    projectCount: z.number().int().nonnegative().safe(),
    threads: z.array(codexHistoryThreadOptionSchema).max(50),
    threadsTruncated: z.boolean(),
    projects: z.array(codexHistoryProjectOptionSchema).max(50),
    projectsTruncated: z.boolean(),
  })
  .strict();

export const codexHistoryFilterOptionsSchema = z
  .object({
    projects: z.array(codexHistoryProjectOptionSchema).max(1_000),
    sections: z.array(codexHistorySectionOptionSchema).max(100),
    recentThreads: z.array(codexHistoryThreadOptionSchema).max(20),
    threads: z.array(codexHistoryThreadOptionSchema).max(50),
    threadsTruncated: z.boolean(),
  })
  .strict();

export const codexHistorySearchPageSchema = z
  .object({
    query: z.string().max(500),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(10).max(50),
    pageCount: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().safe(),
    truncated: z.boolean(),
    items: z.array(codexHistorySearchResultSchema).max(50),
    index: codexHistoryIndexStateSchema,
  })
  .strict();

export type CodexHistoryArchiveFilter = z.infer<typeof codexHistoryArchiveFilterSchema>;
export type CodexHistoryRoleFilter = z.infer<typeof codexHistoryRoleFilterSchema>;
export type CodexHistorySearchScope = z.infer<typeof codexHistorySearchScopeSchema>;
export type CodexHistoryMatchRole = z.infer<typeof codexHistoryMatchRoleSchema>;
export type CodexHistoryThreadSource = z.infer<typeof codexHistoryThreadSourceSchema>;
export type CodexHistoryThreadMessagesSource = z.infer<typeof codexHistoryThreadMessagesSourceSchema>;
export type CodexHistoryIndexStatus = z.infer<typeof codexHistoryIndexStatusSchema>;
export type CodexHistoryIndexState = z.infer<typeof codexHistoryIndexStateSchema>;
export type CodexHistorySearchInput = z.infer<typeof codexHistorySearchInputSchema>;
export type CodexHistoryFilterOptionsInput = z.infer<typeof codexHistoryFilterOptionsInputSchema>;
export type CodexHistoryFilterOptions = z.infer<typeof codexHistoryFilterOptionsSchema>;
export type CodexHistoryProjectOption = z.infer<typeof codexHistoryProjectOptionSchema>;
export type CodexHistorySectionOption = z.infer<typeof codexHistorySectionOptionSchema>;
export type CodexHistoryThreadOption = z.infer<typeof codexHistoryThreadOptionSchema>;
export type CodexHistoryRefreshInput = z.infer<typeof codexHistoryRefreshInputSchema>;
export type CodexHistorySearchResult = z.infer<typeof codexHistorySearchResultSchema>;
export type CodexHistorySearchPage = z.infer<typeof codexHistorySearchPageSchema>;
export type CodexHistoryMessagePhase = z.infer<typeof codexHistoryMessagePhaseSchema>;
export type CodexHistoryContextKind = z.infer<typeof codexHistoryContextKindSchema>;
export type CodexHistoryMessageBlock = z.infer<typeof codexHistoryMessageBlockSchema>;
export type CodexHistoryMessage = z.infer<typeof codexHistoryMessageSchema>;
export type CodexHistoryThreadMessagesInput = z.infer<typeof codexHistoryThreadMessagesInputSchema>;
export type CodexHistoryThreadMessagesPage = z.infer<typeof codexHistoryThreadMessagesPageSchema>;

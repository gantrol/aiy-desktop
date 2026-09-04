import { z } from 'zod';

const isoTimestampSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z.iso.date();
const threadIdSchema = z.string().trim().min(1).max(512);
const projectIdSchema = z.string().trim().max(512);
const sectionIdSchema = z.string().trim().max(512);

export const codexHistoryArchiveFilterSchema = z.enum(['ALL', 'ACTIVE', 'ARCHIVED']);
export const codexHistoryRoleFilterSchema = z.enum(['ALL', 'USER', 'ASSISTANT']);
export const codexHistoryMatchRoleSchema = z.enum(['THREAD', 'USER', 'ASSISTANT']);
export const codexHistoryThreadSourceSchema = z.enum(['USER', 'SUBAGENT', 'OTHER']);
export const codexHistoryIndexStatusSchema = z.enum(['EMPTY', 'INDEXING', 'READY', 'UNAVAILABLE', 'ERROR']);
export const codexHistoryThreadMessagesSourceSchema = z.enum(['PAGINATED', 'LEGACY']);

export const codexHistorySearchInputSchema = z
  .object({
    query: z.string().trim().max(500),
    archive: codexHistoryArchiveFilterSchema.default('ALL'),
    role: codexHistoryRoleFilterSchema.default('ALL'),
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

export const codexHistoryThreadMessagesInputSchema = z
  .object({
    threadId: threadIdSchema,
    cursor: z.number().int().nonnegative().safe().nullable().default(null),
    pageSize: z.number().int().min(10).max(50),
  })
  .strict();

export const codexHistoryMessageSchema = z
  .object({
    messageId: z.string().trim().min(1).max(512),
    role: z.enum(['USER', 'ASSISTANT']),
    createdAt: isoTimestampSchema,
    text: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict();

export const codexHistoryThreadMessagesPageSchema = z
  .object({
    threadId: threadIdSchema,
    source: codexHistoryThreadMessagesSourceSchema,
    modelProvider: z.string().trim().min(1).max(200).nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
    messages: z.array(codexHistoryMessageSchema).max(50),
    nextCursor: z.number().int().nonnegative().safe().nullable(),
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
export type CodexHistoryMessage = z.infer<typeof codexHistoryMessageSchema>;
export type CodexHistoryThreadMessagesInput = z.infer<typeof codexHistoryThreadMessagesInputSchema>;
export type CodexHistoryThreadMessagesPage = z.infer<typeof codexHistoryThreadMessagesPageSchema>;

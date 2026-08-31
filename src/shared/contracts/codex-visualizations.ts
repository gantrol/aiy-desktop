import { z } from 'zod';

const sessionIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
const artifactIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const isoTimestampSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z.iso.date();
const MAX_MERMAID_PREVIEW_CHARACTERS = 512 * 1024;

export const codexVisualizationDateRangeSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .strict()
  .refine(({ from, to }) => from <= to, { message: 'Visualization date range must be ordered' });

export const codexVisualizationArtifactKindSchema = z.enum([
  'INTERACTIVE',
  'IMAGE',
  'VECTOR',
  'DOCUMENT',
  'DIAGRAM_SOURCE',
  'SUPPORT',
]);

export const codexVisualizationArtifactRoleSchema = z.enum(['PRIMARY', 'SUPPORTING']);
export const codexVisualizationArtifactSourceKindSchema = z.enum(['FILE', 'THREAD_MESSAGE']);

export const codexVisualizationArtifactSchema = z
  .object({
    id: artifactIdSchema,
    sessionId: sessionIdSchema,
    relativePath: z.string().min(1).max(1_024),
    fileName: z.string().min(1).max(255),
    extension: z.string().min(1).max(24),
    sourceKind: codexVisualizationArtifactSourceKindSchema,
    kind: codexVisualizationArtifactKindSchema,
    role: codexVisualizationArtifactRoleSchema,
    byteSize: z.number().int().nonnegative().max(1_073_741_824),
    modifiedAt: isoTimestampSchema,
    mediaUrl: z.string().max(512).nullable(),
  })
  .strict();

export const codexVisualizationSessionSchema = z
  .object({
    sessionId: sessionIdSchema,
    threadName: z.string().min(1).max(200),
    threadTitleAvailable: z.boolean(),
    modifiedAt: isoTimestampSchema,
    artifactCount: z.number().int().nonnegative().max(256),
    primaryCount: z.number().int().positive().max(256),
    artifacts: z.array(codexVisualizationArtifactSchema).max(256),
  })
  .strict();

export const codexVisualizationFilterSchema = z.enum(['VISIBLE', 'HIDDEN']);

export const codexVisualizationListInputSchema = z
  .object({
    filter: codexVisualizationFilterSchema.default('VISIBLE'),
    page: z.number().int().min(1).max(100_000),
    pageSize: z.number().int().min(6).max(30),
    hiddenSessionIds: z.array(sessionIdSchema).max(1_000).default([]),
    favoriteSessionIds: z.array(sessionIdSchema).max(1_000).default([]),
    threadDiagramDateRange: codexVisualizationDateRangeSchema.nullable().default(null),
    refresh: z.boolean().optional(),
  })
  .strict()
  .transform((input) => ({
    ...input,
    hiddenSessionIds: [...new Set(input.hiddenSessionIds)],
    favoriteSessionIds: [...new Set(input.favoriteSessionIds)],
  }));

export const codexVisualizationSnapshotSchema = z
  .object({
    available: z.boolean(),
    rootPath: z.string().max(32_768),
    scannedAt: isoTimestampSchema,
    threadDiagramDateRange: codexVisualizationDateRangeSchema.nullable(),
    filter: codexVisualizationFilterSchema,
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(30),
    pageCount: z.number().int().nonnegative(),
    totalSessionCount: z.number().int().nonnegative(),
    filteredSessionCount: z.number().int().nonnegative(),
    hiddenSessionCount: z.number().int().nonnegative(),
    totalArtifactCount: z.number().int().nonnegative(),
    threadDiagramArtifactCount: z.number().int().nonnegative(),
    sessions: z.array(codexVisualizationSessionSchema).max(30),
  })
  .strict();

export const codexVisualizationArtifactActionInputSchema = z.object({ artifactId: artifactIdSchema }).strict();

export const codexVisualizationSessionActionInputSchema = z.object({ sessionId: sessionIdSchema }).strict();

const htmlPreviewIdSchema = z.string().regex(/^[a-f0-9]{48}$/);

export const codexVisualizationHtmlPreviewSchema = z
  .object({
    previewId: htmlPreviewIdSchema,
    artifactId: artifactIdSchema,
    url: z.string().regex(/^aiy-visualization-preview:\/\/[a-f0-9]{48}\//),
    expiresAt: isoTimestampSchema,
  })
  .strict();

export const codexVisualizationHtmlPreviewReleaseInputSchema = z.object({ previewId: htmlPreviewIdSchema }).strict();

export const codexVisualizationMermaidPreviewSchema = z
  .object({
    artifactId: artifactIdSchema,
    sourceText: z.string().min(1).max(MAX_MERMAID_PREVIEW_CHARACTERS),
  })
  .strict();

export const codexVisualizationExportResultSchema = z
  .object({
    canceled: z.boolean(),
    exportedFileCount: z.number().int().nonnegative().max(256),
    destinationPath: z.string().max(32_768).nullable(),
  })
  .strict();

export type CodexVisualizationArtifactKind = z.infer<typeof codexVisualizationArtifactKindSchema>;
export type CodexVisualizationArtifactRole = z.infer<typeof codexVisualizationArtifactRoleSchema>;
export type CodexVisualizationArtifactSourceKind = z.infer<typeof codexVisualizationArtifactSourceKindSchema>;
export type CodexVisualizationDateRange = z.infer<typeof codexVisualizationDateRangeSchema>;
export type CodexVisualizationArtifactDto = z.infer<typeof codexVisualizationArtifactSchema>;
export type CodexVisualizationSessionDto = z.infer<typeof codexVisualizationSessionSchema>;
export type CodexVisualizationFilter = z.infer<typeof codexVisualizationFilterSchema>;
export type CodexVisualizationListInput = z.infer<typeof codexVisualizationListInputSchema>;
export type CodexVisualizationSnapshotDto = z.infer<typeof codexVisualizationSnapshotSchema>;
export type CodexVisualizationArtifactActionInput = z.infer<typeof codexVisualizationArtifactActionInputSchema>;
export type CodexVisualizationSessionActionInput = z.infer<typeof codexVisualizationSessionActionInputSchema>;
export type CodexVisualizationHtmlPreviewDto = z.infer<typeof codexVisualizationHtmlPreviewSchema>;
export type CodexVisualizationHtmlPreviewReleaseInput = z.infer<typeof codexVisualizationHtmlPreviewReleaseInputSchema>;
export type CodexVisualizationMermaidPreviewDto = z.infer<typeof codexVisualizationMermaidPreviewSchema>;
export type CodexVisualizationExportResult = z.infer<typeof codexVisualizationExportResultSchema>;

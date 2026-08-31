import { z } from 'zod';

export const backgroundIssueKindSchema = z.enum(['GENERATION_RUN', 'DIRECTION_EXPERIMENT_DIRECTOR']);
export type BackgroundIssueKind = z.infer<typeof backgroundIssueKindSchema>;

export const backgroundIssueOccurrenceIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const backgroundIssueSchema = z
  .object({
    kind: backgroundIssueKindSchema,
    subjectId: z.string().trim().min(1).max(128),
    occurrenceId: backgroundIssueOccurrenceIdSchema,
    acknowledgedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type BackgroundIssueDto = z.infer<typeof backgroundIssueSchema>;

export function backgroundIssueIdentityKey(issue: Pick<BackgroundIssueDto, 'kind' | 'subjectId' | 'occurrenceId'>) {
  return JSON.stringify([issue.kind, issue.subjectId, issue.occurrenceId]);
}

export const backgroundIssueAcknowledgeInputSchema = backgroundIssueSchema
  .pick({ kind: true, subjectId: true, occurrenceId: true })
  .strict();
export type BackgroundIssueAcknowledgeInput = z.infer<typeof backgroundIssueAcknowledgeInputSchema>;

export const backgroundIssueAcknowledgeResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ACKNOWLEDGED'), issue: backgroundIssueSchema }).strict(),
  z.object({ status: z.literal('ALREADY_ACKNOWLEDGED'), issue: backgroundIssueSchema }).strict(),
  z
    .object({
      status: z.literal('CONFLICT'),
      currentIssue: backgroundIssueSchema.nullable(),
    })
    .strict(),
  z.object({ status: z.literal('NOT_ACTIONABLE') }).strict(),
]);
export type BackgroundIssueAcknowledgeResult = z.infer<typeof backgroundIssueAcknowledgeResultSchema>;

export const legacyGenerationDismissalImportInputSchema = z
  .object({ runIds: z.array(z.string().trim().min(1).max(128)).max(200) })
  .strict();
export type LegacyGenerationDismissalImportInput = z.infer<typeof legacyGenerationDismissalImportInputSchema>;

export const legacyGenerationDismissalImportResultSchema = z
  .object({
    importedRunIds: z.array(z.string()),
    ignoredRunIds: z.array(z.string()),
  })
  .strict();
export type LegacyGenerationDismissalImportResult = z.infer<typeof legacyGenerationDismissalImportResultSchema>;

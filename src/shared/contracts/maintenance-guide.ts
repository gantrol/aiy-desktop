import { z } from 'zod';

export const maintenanceToolIds = [
  'searchConsole',
  'analytics',
  'trends',
  'ads',
  'ahrefs',
  'semrush',
  'bing',
  'pagespeed',
  'baidu',
  'explodingTopics',
  'similarweb',
  'githubActions',
  'cloudflare',
  'sentry',
  'uptimeKuma',
  'healthchecks',
] as const;
export const maintenanceToolIdSchema = z.enum(maintenanceToolIds);
export type MaintenanceToolId = z.infer<typeof maintenanceToolIdSchema>;
export const maintenanceWebUrlSchema = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  });
const optionalUrl = z.union([z.literal(''), maintenanceWebUrlSchema]);
const identifier = z.string().uuid();
export const maintenanceGuideReferenceSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(260),
  path: z.string().min(1).max(4096),
});
export const maintenanceProjectDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  website: optionalUrl,
  release: z.string().trim().max(120),
  notes: z.string().max(20000),
  adsEnabled: z.boolean(),
  toolUrls: z.partialRecord(maintenanceToolIdSchema, maintenanceWebUrlSchema),
});
export type MaintenanceProjectDraft = z.infer<typeof maintenanceProjectDraftSchema>;
export const maintenanceProjectSchema = maintenanceProjectDraftSchema.extend({
  id: identifier,
  guides: z.array(maintenanceGuideReferenceSchema).max(20),
});
export type MaintenanceProject = z.infer<typeof maintenanceProjectSchema>;
export const maintenanceStateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    projects: z.array(maintenanceProjectSchema).max(50),
  })
  .superRefine((state, context) => {
    const ids = state.projects.flatMap((project) => [project.id, ...project.guides.map((guide) => guide.id)]);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate identifiers' });
  });
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;
const revision = z.number().int().nonnegative();
export const maintenanceMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('saveProject'),
    revision,
    projectId: identifier.nullable(),
    project: maintenanceProjectDraftSchema,
  }),
  z.object({ kind: z.literal('removeProject'), revision, projectId: identifier }),
  z.object({ kind: z.literal('removeGuide'), revision, projectId: identifier, guideId: identifier }),
]);
export type MaintenanceMutation = z.infer<typeof maintenanceMutationSchema>;
export const maintenanceProjectInputSchema = z.object({ revision, projectId: identifier });
export const maintenanceReadInputSchema = z.object({ projectId: identifier, guideId: identifier });
export const maintenanceOpenInputSchema = z.object({ projectId: identifier, toolId: maintenanceToolIdSchema });
export const maintenanceRevisionInputSchema = z.object({ revision });
export const maintenanceDocumentSchema = z.object({
  text: z.string().max(262144),
  modifiedAt: z.string(),
});
export type MaintenanceDocument = z.infer<typeof maintenanceDocumentSchema>;
export const maintenanceErrorSchema = z.enum([
  'disabled',
  'invalidInput',
  'conflict',
  'missingProject',
  'fileUnavailable',
  'fileTooLarge',
  'storageUnavailable',
  'openFailed',
]);
export type MaintenanceErrorCode = z.infer<typeof maintenanceErrorSchema>;
export const maintenanceResultSchema = <T extends z.ZodType>(schema: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ ok: z.literal(false), code: maintenanceErrorSchema }),
  ]);
export type MaintenanceResult<T> = { ok: true; value: T } | { ok: false; code: MaintenanceErrorCode };
export interface MaintenanceGuideApi {
  list(): Promise<MaintenanceResult<MaintenanceState>>;
  mutate(input: MaintenanceMutation): Promise<MaintenanceResult<MaintenanceState>>;
  attachGuide(input: z.infer<typeof maintenanceProjectInputSchema>): Promise<MaintenanceResult<MaintenanceState>>;
  readGuide(input: z.infer<typeof maintenanceReadInputSchema>): Promise<MaintenanceResult<MaintenanceDocument>>;
  openTool(input: z.infer<typeof maintenanceOpenInputSchema>): Promise<MaintenanceResult<null>>;
  importProjects(input: z.infer<typeof maintenanceRevisionInputSchema>): Promise<MaintenanceResult<MaintenanceState>>;
  exportProjects(): Promise<MaintenanceResult<boolean>>;
}

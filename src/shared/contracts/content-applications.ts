import { z } from 'zod';

export const CODEX_CONTENT_APPLICATION_ID = 'codex.content';
const applicationId = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
export const contentApplicationSchema = z
  .object({
    id: applicationId,
    extensionId: applicationId,
    name: z.string().min(1).max(120),
    enabled: z.boolean().default(false),
    available: z.boolean(),
    missingPermissions: z.array(z.string()).max(80),
  })
  .strict();
export const contentApplicationCommandSchema = z
  .object({
    applicationId,
    command: z.object({ kind: z.string().min(1).max(80) }).passthrough(),
  })
  .strict();
export type ContentApplication = z.infer<typeof contentApplicationSchema>;
export type ContentApplicationCommand = z.infer<typeof contentApplicationCommandSchema>;
export interface ContentApplicationsApi {
  list(): Promise<ContentApplication[]>;
  command(input: ContentApplicationCommand): Promise<unknown>;
}

import { z } from 'zod';

export const extensionDiagnosticSchema = z.object({
  kind: z.literal('extension-diagnostic'),
  at: z.string().datetime(),
  event: z
    .string()
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/),
  childPid: z.number().int().positive(),
  threadId: z.number().int().nonnegative(),
  rss: z.number().nonnegative(),
  details: z.record(z.string().max(80), z.union([z.string().max(4_096), z.number().finite(), z.boolean(), z.null()])),
});

export type ExtensionDiagnosticDetails = z.infer<typeof extensionDiagnosticSchema>['details'];

export function isExtensionDiagnostic(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'extension-diagnostic');
}

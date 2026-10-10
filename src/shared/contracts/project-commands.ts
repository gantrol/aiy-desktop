import { z } from 'zod';

export const projectCommandGroups = ['run', 'debug', 'release', 'other'] as const;
export const projectCommandSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  group: z.enum(projectCommandGroups),
  operation: z.enum(['run', 'debug', 'build', 'test', 'publish', 'archive', 'configure']).optional(),
  command: z.string().max(8000),
  directory: z.string().max(4096),
  source: z.string().max(4096),
  fingerprint: z.string().max(64),
  tool: z.string().max(80),
  platform: z.enum(['any', 'win32', 'darwin', 'linux']),
  shell: z.enum(['powershell', 'posix', 'cmd']),
  origin: z.enum(['configuration', 'suggestion', 'manual', 'ai']),
  status: z.enum(['ready', 'incomplete', 'changed', 'missing']),
  edited: z.boolean(),
  detail: z.string().max(12000),
});
export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export const projectCommandListSchema = z
  .array(projectCommandSchema)
  .max(256)
  .superRefine((commands, context) => {
    if (new Set(commands.map((command) => command.id)).size !== commands.length)
      context.addIssue({ code: 'custom', message: 'Duplicate command identifiers' });
  });
export const projectCommandScanSchema = z.object({
  commands: projectCommandListSchema,
  issues: z
    .array(
      z.object({
        path: z.string().max(4096),
        code: z.enum(['unreadable', 'invalid', 'limit', 'partial', 'manager', 'boundary']),
      }),
    )
    .max(128),
  scannedAt: z.string(),
});
export type ProjectCommandScan = z.infer<typeof projectCommandScanSchema>;
export const projectCommandScanInputSchema = z.object({
  projectId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  chooseDirectory: z.boolean(),
});
export const projectCommandCancelInputSchema = z.object({ requestId: z.string().uuid() });

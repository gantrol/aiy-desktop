import { z } from 'zod';

export const agentPermissionKeys = [
  'readContent',
  'writeContent',
  'manageWork',
  'generate',
  'externalActions',
] as const;
export type AgentPermission = (typeof agentPermissionKeys)[number];
export const agentPermissionFlagsSchema = z
  .object({
    readContent: z.boolean(),
    writeContent: z.boolean(),
    manageWork: z.boolean(),
    generate: z.boolean(),
    externalActions: z.boolean(),
  })
  .strict();
export const agentPermissionsSchema = z
  .object({
    spaceId: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
    grants: agentPermissionFlagsSchema,
  })
  .strict();
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
export const deniedAgentPermissions = (): AgentPermissions['grants'] => ({
  readContent: false,
  writeContent: false,
  manageWork: false,
  generate: false,
  externalActions: false,
});
export interface AgentPermissionsApi {
  read(): Promise<AgentPermissions>;
  save(input: AgentPermissions): Promise<AgentPermissions>;
}

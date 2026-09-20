import { z } from 'zod';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const agentContentTargetSchema = z
  .object({
    spaceId: identifier,
    target: z.enum(['article', 'material']),
    entityId: identifier,
  })
  .strict();
export type AgentContentTarget = z.infer<typeof agentContentTargetSchema>;

export function agentContentTarget(url: string): AgentContentTarget | null {
  const command = parseAiyDeepLink(url);
  if (!command || (command.target !== 'article' && command.target !== 'material')) return null;
  return { spaceId: command.spaceId, target: command.target, entityId: command.entityId };
}

export function agentContentUrl(target: AgentContentTarget) {
  const parsed = agentContentTargetSchema.parse(target);
  return `aiy://open/space/${parsed.spaceId}/${parsed.target}/${parsed.entityId}`;
}

export const agentContentReadRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    url: z
      .string()
      .max(2048)
      .refine((url) => Boolean(agentContentTarget(url)), 'Unsupported AIY content link'),
  })
  .strict();
export type AgentContentReadRequest = z.infer<typeof agentContentReadRequestSchema>;

export const agentContentReadResultSchema = z
  .object({
    url: z.string().max(2048),
    spaceId: identifier,
    target: z.enum(['article', 'material']),
    entityId: identifier,
    title: z.string(),
    revisionId: identifier.nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    markdown: z.string().max(1_000_000),
    media: z
      .array(
        z
          .object({
            assetId: identifier,
            absolutePath: z.string().min(1).max(32_768),
            mimeType: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            byteSize: z.number().nonnegative(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type AgentContentReadResult = z.infer<typeof agentContentReadResultSchema>;

export const agentContentLinkResultSchema = z
  .object({
    url: z.string().max(2048),
    executable: z.literal('node'),
    args: z.array(z.string().max(32_768)).max(10),
    input: agentContentReadRequestSchema,
  })
  .strict();
export type AgentContentLinkResult = z.infer<typeof agentContentLinkResultSchema>;

export const agentContentCapabilities = {
  readCommand: 'content read',
  targets: ['article', 'material'],
  revision: 'CURRENT_SAVED',
  maximumMarkdownCharacters: 1_000_000,
  maximumMedia: 100,
  remoteMediaFetched: false,
} as const;

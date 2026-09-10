import { z } from 'zod';

export const AGENT_INTAKE_MARKDOWN_BYTES = 1024 * 1024;
export const AGENT_INTAKE_IMAGE_BYTES = 25 * 1024 * 1024;
const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const agentIntakeImportRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    requestId: identifier,
    spaceId: identifier,
    kind: z.enum(['ARTICLE', 'IMAGE_MATERIAL']),
    path: z.string().min(1).max(32_768),
    expectedSha256: sha256,
    title: z.string().trim().max(200).default(''),
    provenance: z.object({ application: z.literal('codex'), threadId: identifier.optional() }).strict(),
  })
  .strict();

export const agentIntakeGetRequestSchema = z
  .object({ protocolVersion: z.literal(1), requestId: identifier, spaceId: identifier })
  .strict();

export const agentIntakeResultSchema = z
  .object({
    requestId: identifier,
    spaceId: identifier,
    kind: z.enum(['ARTICLE', 'IMAGE_MATERIAL']),
    entityId: identifier,
    revisionId: identifier.nullable(),
    title: z.string().min(1).max(200),
    sourceSha256: sha256,
    reused: z.boolean(),
    status: z.literal('COMMITTED'),
    openUrl: z
      .string()
      .max(2_048)
      .regex(/^aiy:\/\/open\/space\/[A-Za-z0-9._:-]+\/(article|material)\/[A-Za-z0-9._:-]+$/),
  })
  .strict();

export const agentIntakeCapabilities = {
  command: 'intake import',
  getCommand: 'intake get',
  kinds: ['ARTICLE', 'IMAGE_MATERIAL'],
  articleExtensions: ['.md', '.markdown'],
  imageMimeTypes: ['image/png'],
  maximumArticleBytes: AGENT_INTAKE_MARKDOWN_BYTES,
  maximumImageBytes: AGENT_INTAKE_IMAGE_BYTES,
  maximumImageDimension: 4_096,
  requiresExpectedSha256: true,
  requiresSpaceId: true,
  attachmentsAccepted: false,
  remoteUrlsAccepted: false,
  directoriesAccepted: false,
} as const;

export type AgentIntakeImportRequest = z.infer<typeof agentIntakeImportRequestSchema>;
export type AgentIntakeGetRequest = z.infer<typeof agentIntakeGetRequestSchema>;
export type AgentIntakeResult = z.infer<typeof agentIntakeResultSchema>;

import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const scopeSchema = z.object({ protocolVersion: z.literal(1), spaceId: identifier, locale: z.enum(['zh', 'en']) });
const albumSchema = z
  .object({
    id: identifier,
    title: z.string().min(1).max(200),
    parentId: identifier.nullable(),
    materialCount: z.number().int().nonnegative(),
  })
  .strict();

export const agentAlbumListRequestSchema = scopeSchema
  .extend({
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export const agentAlbumEnsureRequestSchema = scopeSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    parentAlbumId: identifier.optional(),
  })
  .strict();
export const agentAlbumAddRequestSchema = scopeSchema
  .extend({
    albumId: identifier,
    materialIds: z.array(identifier).min(1).max(200),
  })
  .strict();
export const agentAlbumRemoveRequestSchema = agentAlbumAddRequestSchema;

export const agentAlbumListResultSchema = z
  .object({
    spaceId: identifier,
    albums: z.array(albumSchema).max(200),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const agentAlbumEnsureResultSchema = z
  .object({
    spaceId: identifier,
    album: albumSchema,
    created: z.boolean(),
  })
  .strict();
export const agentAlbumAddResultSchema = z
  .object({
    spaceId: identifier,
    album: albumSchema,
    materialIds: z.array(identifier).min(1).max(200),
  })
  .strict();
export const agentAlbumRemoveResultSchema = agentAlbumAddResultSchema;

export const agentAlbumCapabilities = {
  listCommand: 'album list',
  ensureCommand: 'album ensure',
  addCommand: 'album add',
  removeCommand: 'album remove',
  removalScope: 'MEMBERSHIP_ONLY',
  scope: 'MATERIAL_COLLECTION',
  requiresSpaceId: true,
  maximumMaterialsPerCommand: 200,
  duplicateMemberships: 'REUSE',
  ambiguousTitles: 'REJECT',
} as const;

export type AgentAlbumListRequest = z.infer<typeof agentAlbumListRequestSchema>;
export type AgentAlbumEnsureRequest = z.infer<typeof agentAlbumEnsureRequestSchema>;
export type AgentAlbumAddRequest = z.infer<typeof agentAlbumAddRequestSchema>;
export type AgentAlbumRemoveRequest = z.infer<typeof agentAlbumRemoveRequestSchema>;

import { z } from 'zod';

const id = z.string().min(1).max(200);
const scope = z.object({ protocolVersion: z.literal(1), spaceId: id }).strict();
const album = z.object({ id, title: z.string(), parentAlbumId: id.nullable() }).strict();
export const agentCreationAlbumsSchema = scope.extend({
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(200).default(200),
});
export const agentCreationAlbumsResultSchema = z
  .object({
    spaceId: id,
    albums: z.array(album).max(200),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const agentCreationEnsureAlbumSchema = scope.extend({
  title: z.string().trim().min(1).max(200),
  parentAlbumId: id.nullable().default(null),
  locale: z.enum(['zh', 'en']),
});
export const agentCreationEnsureAlbumResultSchema = z
  .object({
    spaceId: id,
    album,
    created: z.boolean(),
  })
  .strict();
const entry = z
  .object({
    creationItemId: id.optional(),
    articleId: id.optional(),
    expectedAlbumId: id.nullable(),
    expectedParentCreationItemId: id.nullable().default(null),
  })
  .strict()
  .refine((value) => Boolean(value.creationItemId) !== Boolean(value.articleId), 'Specify creationItemId or articleId');
export const agentCreationMoveSchema = scope.extend({
  albumId: id,
  entries: z.array(entry).min(1).max(100),
});
export const agentCreationMoveResultSchema = z
  .object({
    spaceId: id,
    albumId: id,
    entries: z.array(z.object({ creationItemId: id, moved: z.boolean() }).strict()).max(100),
  })
  .strict();
export const agentCreationCapabilities = {
  commands: ['creation albums', 'creation ensure-album', 'creation move'],
  maximumBatchSize: 100,
  moves: 'LEAF_ITEMS',
  requiresExpectedAlbumAndParent: true,
} as const;

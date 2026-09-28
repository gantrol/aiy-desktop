import { z } from 'zod';
import { contentLinkResultSchema } from '@/shared/contracts/content-links';

const id = z.string().min(1).max(200);
export const creationOrganizationCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('album-note'),
      spaceId: id,
      albumId: id,
      title: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('create-child'),
      spaceId: id,
      parentCreationItemId: id,
      requestId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      format: z.enum(['MANUSCRIPT', 'OUTLINE']),
    })
    .strict(),
]);
export const creationOrganizationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('opened'), link: contentLinkResultSchema }).strict(),
  z
    .object({
      kind: z.literal('error'),
      code: z.enum(['CHANGED', 'UNAVAILABLE', 'FAILED']),
    })
    .strict(),
]);
export type CreationOrganizationCommand = z.infer<typeof creationOrganizationCommandSchema>;
export type CreationOrganizationResult = z.infer<typeof creationOrganizationResultSchema>;

import { z } from 'zod';
import type { MaterialAlbumDto, MaterialAlbumMemberDto } from '@/shared/contracts';

const id = z.string().min(1).max(200);
export const materialAlbumMembershipApplySchema = z
  .object({
    spaceId: id,
    locale: z.enum(['en', 'zh']),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('MATERIAL'), materialId: id }).strict(),
      z.object({ kind: z.literal('IMAGE_ASSET'), imageAssetId: id }).strict(),
    ]),
    changes: z
      .array(
        z
          .object({
            albumId: id,
            checked: z.boolean(),
            expected: z
              .object({ id, updatedAt: z.string().min(1) })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(100),
    create: z
      .object({ title: z.string().trim().min(1).max(200), parentAlbumId: id.nullable() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => input.changes.length > 0 || Boolean(input.create))
  .refine((input) => new Set(input.changes.map((change) => change.albumId)).size === input.changes.length);

export type MaterialAlbumMembershipApplyInput = z.infer<typeof materialAlbumMembershipApplySchema>;
export type MaterialAlbumMembershipEdit = Pick<MaterialAlbumMembershipApplyInput, 'changes' | 'create'>;
export interface MaterialAlbumMembershipPatch {
  albumId: string;
  previousMemberId: string | null;
  member: MaterialAlbumMemberDto | null;
  updatedAt: string;
}
export type MaterialAlbumMembershipApplyResult =
  | { status: 'APPLIED'; patches: MaterialAlbumMembershipPatch[]; createdAlbum: MaterialAlbumDto | null }
  | { status: 'CONFLICT' | 'UNAVAILABLE' | 'WRONG_LIBRARY' | 'FAILED' };

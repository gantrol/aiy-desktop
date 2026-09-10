import { z } from 'zod';
import { socialPostContentSchema, socialPostRevisionSaveInputSchema } from '@/shared/contracts/social-post';

const id = z.string().min(1).max(200);
export const SOCIAL_POST_RECOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const socialPostRecoveryScopeSchema = z.object({ spaceId: id, postId: id }).strict();
export const socialPostRecoverySnapshotSchema = z
  .object({
    content: socialPostContentSchema,
    baseRevisionId: id,
    // Old sessionStorage copies did not retain their baseline content.
    baseContent: socialPostContentSchema.nullable(),
    pending: socialPostRevisionSaveInputSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pending && value.pending.expectedRevisionId !== value.baseRevisionId)
      context.addIssue({ code: 'custom', message: 'Recovery request baseline does not match' });
  });
const record = socialPostRecoveryScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    revision: id,
    snapshot: socialPostRecoverySnapshotSchema.nullable(),
  })
  .strict();
function matchesPost(value: z.infer<typeof record>) {
  return !value.snapshot?.pending || value.snapshot.pending.postId === value.postId;
}
export const socialPostRecoveryRecordSchema = record.refine(matchesPost, 'Recovery request post does not match');
export const socialPostRecoverySaveSchema = record
  .extend({ expectedRevision: id.nullable() })
  .strict()
  .refine(matchesPost, 'Recovery request post does not match');
export const socialPostRecoverySaveResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), record: socialPostRecoveryRecordSchema }).strict(),
  z.object({ status: z.literal('conflict'), record: socialPostRecoveryRecordSchema.nullable() }).strict(),
]);
export type SocialPostRecoveryScope = z.infer<typeof socialPostRecoveryScopeSchema>;
export type SocialPostRecoverySnapshot = z.infer<typeof socialPostRecoverySnapshotSchema>;
export type SocialPostRecoveryRecord = z.infer<typeof socialPostRecoveryRecordSchema>;
export type SocialPostRecoverySave = z.infer<typeof socialPostRecoverySaveSchema>;
export type SocialPostRecoverySaveResult = z.infer<typeof socialPostRecoverySaveResultSchema>;
export interface SocialPostRecoveryApi {
  socialPostRecoveryLoad(scope: SocialPostRecoveryScope): Promise<SocialPostRecoveryRecord | null>;
  socialPostRecoverySave(input: SocialPostRecoverySave): Promise<SocialPostRecoverySaveResult>;
}

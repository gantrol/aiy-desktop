import { z } from 'zod';
import { articleOpenResultSchema } from '@/shared/contracts/article';
const id = z.string().min(1).max(200);
export const outlineTransferInputSchema = z
  .object({
    sourceArticleId: id,
    sourceRevisionId: id,
    targetArticleId: id,
    targetRevisionId: id,
    selectedIds: z.array(id).min(1).max(200),
    targetId: id,
    placement: z.enum(['BEFORE', 'AFTER', 'INSIDE']),
    copy: z.boolean(),
  })
  .strict();
export const outlineTransferResultSchema = z
  .object({ source: articleOpenResultSchema.shape.article, target: articleOpenResultSchema.shape.article })
  .strict();
export type OutlineTransferInput = z.infer<typeof outlineTransferInputSchema>;
export type OutlineTransferResult = z.infer<typeof outlineTransferResultSchema>;

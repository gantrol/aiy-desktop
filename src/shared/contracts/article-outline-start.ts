import { z } from 'zod';
import type { ArticleOpenResult } from '@/shared/contracts/article';

const id = z.string().min(1).max(200);
export const articleOutlineStartInputSchema = z
  .object({
    spaceId: id,
    articleId: id,
    expectedRevisionId: id,
    requestId: z.string().uuid(),
  })
  .strict();

export type ArticleOutlineStartInput = z.infer<typeof articleOutlineStartInputSchema>;
export type ArticleOutlineStartResult = ArticleOpenResult;

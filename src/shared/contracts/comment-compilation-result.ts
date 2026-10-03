import { z } from 'zod';
import { articleOpenResultSchema } from '@/shared/contracts/article';
import { creationItemSchema } from '@/shared/contracts/creation-library';

// Kept outside the origin contract: article authorship also imports that contract.
export const commentCompilationResultSchema = z
  .object({
    spaceId: z.string().min(1).max(200),
    article: articleOpenResultSchema.shape.article,
    creationItem: creationItemSchema,
    created: z.boolean(),
  })
  .strict()
  .refine(
    ({ article, creationItem }) =>
      creationItem.forms.some((form) => form.entity.kind === 'ARTICLE' && form.entity.id === article.id),
    'COMMENT_COMPILATION_REGISTRATION_MISMATCH',
  );

export type CommentCompilationResult = z.infer<typeof commentCompilationResultSchema>;

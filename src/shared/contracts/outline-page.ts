import { z } from 'zod';
import { articleOpenResultSchema } from '@/shared/contracts/article';
import { contentLinkResultSchema } from '@/shared/contracts/content-links';
import { creationItemSchema } from '@/shared/contracts/creation-library';

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u);

export const outlinePageCreateInputSchema = z
  .object({
    spaceId: id,
    requestId: z.string().uuid(),
    sourceArticleId: id,
    expectedRevisionId: id,
    selectedIds: z.array(id).min(1).max(200),
    untitledTitle: z.string().trim().min(1).max(200),
  })
  .strict();

export const outlinePageCreateResultSchema = z
  .object({
    source: articleOpenResultSchema.shape.article,
    page: articleOpenResultSchema.shape.article,
    creationItem: creationItemSchema,
    link: contentLinkResultSchema,
  })
  .strict();

export type OutlinePageCreateInput = z.infer<typeof outlinePageCreateInputSchema>;
export type OutlinePageCreateResult = z.infer<typeof outlinePageCreateResultSchema>;

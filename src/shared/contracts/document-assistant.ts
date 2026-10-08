import { z } from 'zod';
import { blockDocumentSchema } from '@/shared/contracts/block-document';

export const documentWritingTaskSchema = z
  .object({
    kind: z.enum(['draft', 'outline', 'rewrite']),
    // Kept with the request for adoption; never sent to the model as instructions.
    baseDocument: blockDocumentSchema,
    selection: z
      .object({
        from: z.number().int().nonnegative(),
        to: z.number().int().positive(),
        text: z
          .string()
          .min(1)
          .max(30_000)
          .refine((value) => Boolean(value.trim())),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((task) =>
    task.kind === 'rewrite'
      ? Boolean(task.selection && task.selection.to > task.selection.from)
      : task.selection === null,
  );

export type DocumentWritingTask = z.infer<typeof documentWritingTaskSchema>;

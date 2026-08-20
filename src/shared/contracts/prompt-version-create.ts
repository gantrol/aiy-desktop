import { z } from 'zod';

export const promptVersionCreateResultSchema = z
  .object({
    seriesId: z.string(),
    versionId: z.string(),
  })
  .strict();

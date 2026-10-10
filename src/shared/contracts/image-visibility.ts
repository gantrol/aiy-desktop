import { z } from 'zod';

export const imageVisibilityUpdateSchema = z
  .object({
    assetIds: z.array(z.string().min(1).max(200)).min(1).max(500),
    hidden: z.boolean(),
  })
  .strict();

export type ImageVisibilityUpdate = z.infer<typeof imageVisibilityUpdateSchema>;

export interface ImageVisibilityApi {
  list(): Promise<string[]>;
  set(input: ImageVisibilityUpdate): Promise<void>;
}

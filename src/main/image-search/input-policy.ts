import { z } from 'zod';
import { imageInputFailureSchema } from '@/shared/contracts/image-search-issues';

// Capability changes retry failures without discarding compatible successful vectors.
export const IMAGE_INPUT_POLICY = 'proxy-v1';
export const IMAGE_PREPARE_RSS_BYTES = 768 * 1024 * 1024;
export const IMAGE_PREPARE_TIMEOUT_MS = 45_000;
export const imagePrepareCommandSchema = z.object({
  op: z.literal('prepare'),
  path: z.string(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.string(),
  purpose: z.enum(['visual', 'ocr']),
});
export const imagePreparedSchema = z.union([
  z.object({ path: z.string(), width: z.number().positive(), height: z.number().positive(), limited: z.boolean() }),
  z.object({ failure: imageInputFailureSchema }),
]);
export type PreparedImage = z.infer<typeof imagePreparedSchema>;

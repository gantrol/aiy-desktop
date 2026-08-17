import { z } from 'zod';

const exampleId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/);
const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const contentPackExampleSchema = z
  .object({
    assetId: exampleId,
    source: z.string().trim().min(1).max(240),
    termStableKey: stableKey,
    mediaId: exampleId.optional(),
    evidenceId: exampleId.optional(),
    status: z.enum(['ACCEPTED', 'REJECTED']),
    role: z.enum(['COVER', 'RELATED', 'NEGATIVE_EVIDENCE']).optional(),
    note: z.string().max(20_000).optional(),
  })
  .passthrough();

export const contentPackExamplesDocumentSchema = z
  .object({
    schemaVersion: z.literal('0.3'),
    revision: z.string().trim().min(1).max(200),
    examples: z.array(contentPackExampleSchema).max(10_000),
  })
  .passthrough();

export type ContentPackExamplesDocument = z.infer<typeof contentPackExamplesDocumentSchema>;
export type ContentPackExample = ContentPackExamplesDocument['examples'][number];

import { z } from 'zod';
import type { TermDraftInput } from '@/shared/contracts';

const id = z.string().min(1).max(200);
const contentLocale = z.string().trim().min(1).max(64);
const stringList = z.array(z.string().max(500)).max(100);

export const termDraftSchema: z.ZodType<TermDraftInput> = z.object({
  termId: id,
  title: z.string().min(1).max(300),
  titleLocale: contentLocale,
  definition: z.string().max(10_000),
  aliases: stringList,
  localizations: z
    .array(
      z
        .object({
          locale: contentLocale,
          title: z.string().min(1).max(300),
          definition: z.string().max(10_000),
          aliases: stringList,
        })
        .strict(),
    )
    .max(100),
  classificationIds: z.array(id).max(100),
  primaryDirectoryClassificationId: id.nullable(),
  expressions: z
    .array(
      z
        .object({
          contextKey: z
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9._-]{1,63}$/),
          modelKey: id,
          locale: contentLocale,
          positive: z.string().max(10_000),
          negative: z.string().max(10_000),
        })
        .strict(),
    )
    .max(200),
});

export function parsePersistedTermDraft(serialized: string) {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('Stored term draft contains malformed JSON');
  }
  const parsed = termDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error('Stored term draft does not match the current product baseline');
  return parsed.data;
}

import { z } from 'zod';
import { desktopPetalMessages, type DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

function catalogSchema(base: Record<string, unknown>): z.ZodObject<z.ZodRawShape> {
  return z
    .object(
      Object.fromEntries(
        Object.entries(base).map(([key, value]) => [
          key,
          typeof value === 'string' ? z.string().max(6_000) : catalogSchema(value as Record<string, unknown>),
        ]),
      ),
    )
    .strict();
}
export const petalLanguageSchema = z
  .object({
    locale: z.enum(['en', 'zh']),
    // Runtime shape comes from the complete English catalog; Object.fromEntries loses its static keys.
    messages: catalogSchema(desktopPetalMessages) as unknown as z.ZodType<DesktopPetalMessages>,
  })
  .strict();
export type PetalLanguage = z.infer<typeof petalLanguageSchema>;

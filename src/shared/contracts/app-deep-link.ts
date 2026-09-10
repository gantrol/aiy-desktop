import { z } from 'zod';

export const AIY_DEEP_LINK_SCHEME = 'aiy';
export const APP_DEEP_LINK_AVAILABLE_CHANNEL = 'app:deep-link-available';
export const APP_DEEP_LINKS_TAKE_CHANNEL = 'app:deep-links-take';
export const MAX_PENDING_APP_DEEP_LINKS = 8;

const galleryCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('open'),
    target: z.literal('gallery'),
  })
  .strict();

const contentCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('open'),
    target: z.enum(['article', 'material']),
    spaceId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    entityId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

export const appDeepLinkCommandSchema = z.union([galleryCommandSchema, contentCommandSchema]);
export const appDeepLinkCommandListSchema = z.array(appDeepLinkCommandSchema).max(MAX_PENDING_APP_DEEP_LINKS);

export type AppDeepLinkCommand = z.infer<typeof appDeepLinkCommandSchema>;

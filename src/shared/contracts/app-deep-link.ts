import { z } from 'zod';

export const AIY_DEEP_LINK_SCHEME = 'aiy';
export const APP_DEEP_LINK_AVAILABLE_CHANNEL = 'app:deep-link-available';
export const APP_DEEP_LINKS_TAKE_CHANNEL = 'app:deep-links-take';
export const MAX_PENDING_APP_DEEP_LINKS = 8;

export const appDeepLinkCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('open'),
    target: z.literal('gallery'),
  })
  .strict();

export const appDeepLinkCommandListSchema = z.array(appDeepLinkCommandSchema).max(MAX_PENDING_APP_DEEP_LINKS);

export type AppDeepLinkCommand = z.infer<typeof appDeepLinkCommandSchema>;

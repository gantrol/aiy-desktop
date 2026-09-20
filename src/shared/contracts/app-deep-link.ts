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
    target: z.enum(['article', 'material', 'album']),
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

const calendarCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('open'),
    target: z.literal('calendar'),
    spaceId: contentCommandSchema.shape.spaceId,
  })
  .strict();
export const appDeepLinkCommandSchema = z.union([galleryCommandSchema, contentCommandSchema, calendarCommandSchema]);
export const appDeepLinkCommandListSchema = z.array(appDeepLinkCommandSchema).max(MAX_PENDING_APP_DEEP_LINKS);

export type AppDeepLinkCommand = z.infer<typeof appDeepLinkCommandSchema>;

const rawDeepLinkSchema = z.string().trim().min(1).max(2_048);

export function parseAiyDeepLink(rawValue: unknown): AppDeepLinkCommand | null {
  const parsedValue = rawDeepLinkSchema.safeParse(rawValue);
  if (!parsedValue.success) return null;
  const value = parsedValue.data.replace(/^(["'])(.*)\1$/u, '$2');
  if (value.includes('?') || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${AIY_DEEP_LINK_SCHEME}:` ||
    url.hostname !== 'open' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return null;
  if (url.pathname === '/gallery') return { schemaVersion: 1, action: 'open', target: 'gallery' };
  const calendar = /^\/space\/([A-Za-z0-9._:-]+)\/calendar$/u.exec(url.pathname);
  if (calendar) return { schemaVersion: 1, action: 'open', target: 'calendar', spaceId: calendar[1] };
  const route = /^\/space\/([A-Za-z0-9._:-]+)\/(article|material|album)\/([A-Za-z0-9._:-]+)$/u.exec(url.pathname);
  if (!route) return null;
  const command = appDeepLinkCommandSchema.safeParse({
    schemaVersion: 1,
    action: 'open',
    target: route[2],
    spaceId: route[1],
    entityId: route[3],
  });
  return command.success ? command.data : null;
}

export const albumOpenInputSchema = z
  .object({ spaceId: contentCommandSchema.shape.spaceId, albumId: contentCommandSchema.shape.entityId })
  .strict();
export type AlbumOpenInput = z.infer<typeof albumOpenInputSchema>;
export interface AlbumOpenResult {
  spaceId: string;
  album: import('@/shared/contracts').AlbumDto;
}

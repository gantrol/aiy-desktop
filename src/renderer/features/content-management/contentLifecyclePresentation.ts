import type { ContentLifecycleItemDto, ContentLifecycleSubtype, Locale } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { formatDateTime } from '@/renderer/lib/dateFormat';

const subtypeMessageKeys = {
  CREATION_ALBUM: 'creationAlbum',
  MATERIAL_ALBUM: 'materialAlbum',
  PROMPT_SERIES: 'promptSeries',
  IDEA_CREATION: 'ideaCreation',
  INSPIRATION_STASH: 'inspirationStash',
  SOCIAL_POST: 'socialPost',
  ARTICLE: 'article',
  VIDEO_DOCUMENT: 'videoDocument',
  IMAGE_MATERIAL: 'imageMaterial',
  VIDEO_MATERIAL: 'videoMaterial',
  TEXT_MATERIAL: 'textMaterial',
} as const satisfies Record<ContentLifecycleSubtype, keyof MessageCatalog['contentManagement']['subtypes']>;

const changedAtOptions: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

export function lifecycleSubtypeLabel(item: ContentLifecycleItemDto, messages: MessageCatalog) {
  return messages.contentManagement.subtypes[subtypeMessageKeys[item.subtype]];
}

export function lifecycleChangedAt(item: ContentLifecycleItemDto, locale: Locale) {
  return formatDateTime(item.changedAt, locale, changedAtOptions);
}

export function lifecycleExpiryLabel(item: ContentLifecycleItemDto, messages: MessageCatalog, now = Date.now()) {
  if (!item.expiresAt) return null;
  const remainingMs = new Date(item.expiresAt).getTime() - now;
  const days = Math.max(0, Math.ceil(remainingMs / 86_400_000));
  return days === 0 ? messages.contentManagement.expiresToday : messages.contentManagement.expiresIn(days);
}

export function lifecycleThumbnailUrl(assetId: string) {
  return `aiy-media://asset-thumbnail/${encodeURIComponent(assetId)}?size=144`;
}

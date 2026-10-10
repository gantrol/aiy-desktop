import type { ContentLifecycleItemDto, ContentLifecycleSubtype, Locale } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { formatDateTime } from '@/renderer/lib/dateFormat';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { storedContentPreview } from '@/shared/content-lifecycle-preview';
import { contentDisplayTitle } from '@/shared/content-document';

export function lifecycleTextPresentation(item: ContentLifecycleItemDto, messages: MessageCatalog) {
  const serialized =
    ['ARTICLE', 'SOCIAL_POST', 'INSPIRATION_STASH', 'IMAGE_BREAKDOWN', 'EVALUATION_SUITE'].includes(item.subtype) &&
    /^\s*\{\s*"(?:schemaVersion|title|document|manualPrompt|body|markdown|summary)"\s*:/u.test(item.previewText ?? '');
  const recovered = serialized ? storedContentPreview(item.previewText) : null;
  const previewText = serialized ? (recovered?.previewText ?? null) : item.previewText;
  const title = contentDisplayTitle(
    item.title === item.entityId ? recovered?.title : item.title,
    previewText ?? '',
    messages.contentManagement.untitled,
  );
  return { title, previewText };
}

const subtypeMessageKeys = {
  GIF_DOCUMENT: 'animation',
  CREATION_ALBUM: 'creationAlbum',
  MATERIAL_ALBUM: 'materialAlbum',
  PROMPT_SERIES: 'promptSeries',
  IMAGE_BREAKDOWN: 'imageBreakdown',
  IDEA_CREATION: 'ideaCreation',
  INSPIRATION_STASH: 'inspirationStash',
  EVALUATION_SUITE: 'evaluationSuite',
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
  return mediaThumbnailUrl({ id: assetId }, 144);
}

import type { MessageCatalog } from '@/renderer/i18n/types';

export function articleManagementError(reason: unknown, labels: MessageCatalog['creator']['album']) {
  const detail = reason instanceof Error ? reason.message : String(reason);
  if (detail.includes('ARTICLE_MANAGEMENT_UNAVAILABLE')) return labels.manuscriptUnavailable;
  if (detail.includes('ARTICLE_MANAGEMENT_CHANGED')) return labels.manuscriptChanged;
  if (detail.includes('ARTICLE_MANAGEMENT_REQUIRED')) return labels.manuscriptRequired;
  return detail;
}

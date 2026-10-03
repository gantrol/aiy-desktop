import type { MessageCatalog } from '@/renderer/i18n/catalog';
import type { Channel, Work } from './types';

/** Keep authored titles in the data; resolve generated labels in the current UI language. */
export function workTitle(
  work: Work,
  copy: Pick<MessageCatalog['designLab']['themeCreation'], Channel | 'saveSeparate'>,
) {
  return work.source ? `${work.title} · ${work.channel ? copy[work.channel] : copy.saveSeparate}` : work.title;
}

import { contentImageNumber } from '@/shared/content-image-number';
import { projectNumberedGallery } from '@/shared/content-publishing-mask';
import type { BrowserCompanionSource, BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { xiaohongshuHandoffError } from '@/shared/xiaohongshu-publishing';

export function prepareImagePostHandoff({
  body,
  format,
  leadingMediaAssetIds = [],
  mediaAssetIds,
  mediaBindings,
  source,
  title,
  target,
  copy,
  notify,
}: {
  body: string;
  format: 'markdown' | 'plain';
  leadingMediaAssetIds?: readonly string[];
  mediaAssetIds: readonly string[];
  mediaBindings: readonly { path: string; assetId: string }[];
  source: BrowserCompanionSource;
  title: string;
  target: BrowserCompanionTarget;
  copy: DesktopPetalMessages['document'];
  notify(message: string): void;
}): Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null {
  const projected =
    format === 'markdown'
      ? projectNumberedGallery({
          markdown: body,
          leadingMediaAssetIds,
          mediaAssetIds,
          mediaBindings,
          numbering: copy.numbering,
          imageLabel: (position) => copy.imageNumber.replace('{number}', contentImageNumber(position, copy.numbering)),
        })
      : {
          text: body.trim(),
          mediaAssetIds: [...new Set([...leadingMediaAssetIds, ...mediaAssetIds])],
          missingImages: [],
        };
  const { text, mediaAssetIds: orderedIds } = projected;
  if (projected.missingImages.length) {
    notify(copy.missingImage);
    return null;
  }
  if (!text) {
    notify(copy.bodyRequired);
    return null;
  }
  if (target === 'xiaohongshu') {
    const error = xiaohongshuHandoffError({ title, text, mediaCount: orderedIds.length });
    if (error) throw new Error(error);
  }
  if (text.length > 10_000) {
    notify(copy.bodyLimit);
    return null;
  }
  const mediaLimit = { wechat: 20, weibo: 18, chatgpt: 18, x: 4, xiaohongshu: 18 }[target];
  if (orderedIds.length > mediaLimit) {
    notify(copy.mediaLimit.replace('{count}', String(mediaLimit)));
    return null;
  }
  return {
    source,
    contentKind: 'social-post-body',
    title: title.trim() || undefined,
    text,
    mediaAssetIds: orderedIds,
  };
}

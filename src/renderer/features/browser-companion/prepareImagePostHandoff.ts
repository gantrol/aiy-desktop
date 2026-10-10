import { contentImageNumber } from '@/shared/content-image-number';
import { projectNumberedGallery } from '@/shared/content-publishing-mask';
import type { BrowserCompanionSource, BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { xiaohongshuHandoffError } from '@/shared/xiaohongshu-publishing';
import { publishingMaskMediaOrder } from '@/shared/contracts/publishing-mask';
import { publishingBodyStartsWithTitle } from '@/shared/publishing-body-title';
import { xPostThread, xPostTitleFits } from '@/shared/x-post-text';
import { X_HANDOFF_MEDIA_LIMIT } from '@/shared/x-thread-media';

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
  preferredMediaAssetIds,
  titleInBody = true,
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
  preferredMediaAssetIds?: readonly string[] | null;
  titleInBody?: boolean;
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
          preferredMediaAssetIds,
        })
      : {
          text: body.trim(),
          mediaAssetIds: publishingMaskMediaOrder(
            [...new Set([...leadingMediaAssetIds, ...mediaAssetIds])],
            preferredMediaAssetIds,
          ),
          missingImages: [],
        };
  const { mediaAssetIds: orderedIds } = projected;
  let { text } = projected;
  if (projected.missingImages.length) {
    notify(copy.missingImage);
    return null;
  }
  if (!text) {
    notify(copy.bodyRequired);
    return null;
  }
  const bodyTitle = titleInBody && (target === 'x' || target === 'weibo') ? title.trim() : '';
  if (bodyTitle) {
    if (target === 'x' && !xPostTitleFits(bodyTitle)) {
      notify(copy.xTitleLimit);
      return null;
    }
    if (!publishingBodyStartsWithTitle(body, format, bodyTitle)) text = `${bodyTitle}\n\n${text}`;
  }
  if (target === 'xiaohongshu') {
    const error = xiaohongshuHandoffError({ title, text, mediaCount: orderedIds.length });
    if (error) throw new Error(error);
  }
  if (text.length > 10_000) {
    notify(copy.bodyLimit);
    return null;
  }
  if (target === 'x') {
    const posts = xPostThread(text);
    if (!posts) {
      notify(copy.xThreadInvalid);
      return null;
    }
    if (bodyTitle && !posts[0]?.replace(/\r\n?/gu, '\n').startsWith(bodyTitle.replace(/\r\n?/gu, '\n'))) {
      notify(copy.xTitleLimit);
      return null;
    }
  }
  const mediaLimit = { wechat: 20, weibo: 18, chatgpt: 18, x: X_HANDOFF_MEDIA_LIMIT, xiaohongshu: 18 }[target];
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

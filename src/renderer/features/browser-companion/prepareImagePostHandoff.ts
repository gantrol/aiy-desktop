import { contentAssetPath } from '@/shared/content-document';
import { contentImageNumber } from '@/shared/content-image-number';
import { contentMarkdownText } from '@/shared/content-markdown';
import type { BrowserCompanionSource, BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { xiaohongshuHandoffError } from '@/shared/xiaohongshu-publishing';

export function prepareImagePostHandoff({
  body,
  format,
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
  mediaAssetIds: readonly string[];
  mediaBindings: readonly { path: string; assetId: string }[];
  source: BrowserCompanionSource;
  title: string;
  target: BrowserCompanionTarget;
  copy: DesktopPetalMessages['document'];
  notify(message: string): void;
}): Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null {
  const orderedIds = [...new Set(mediaAssetIds)];
  const imagePositions = new Map(orderedIds.map((id, index) => [id, index + 1]));
  const assetsByPath = new Map(mediaBindings.map((binding) => [binding.path, binding.assetId]));
  for (const id of new Set([...orderedIds, ...mediaBindings.map((binding) => binding.assetId)])) {
    assetsByPath.set(contentAssetPath(id), id);
    assetsByPath.set('aiy-media://asset/' + encodeURIComponent(id), id);
  }
  let missingImage = false;
  const text =
    format === 'markdown'
      ? contentMarkdownText(body, (url) => {
          const id = assetsByPath.get(url);
          if (!id) {
            missingImage = true;
            return '';
          }
          let position = imagePositions.get(id);
          if (!position) {
            orderedIds.push(id);
            position = orderedIds.length;
            imagePositions.set(id, position);
          }
          return copy.imageNumber.replace('{number}', contentImageNumber(position, copy.numbering));
        })
      : body.trim();
  if (missingImage) {
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

import type { BrowserCompanionTarget, ExtensionDto } from '@/shared/contracts';
import { NATURAL_WATERMARK_EXTENSION_ID, WEIBO_CHANNEL_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

export function socialPostBrowserCompanionTargets(
  extensions: readonly ExtensionDto[],
): readonly BrowserCompanionTarget[] {
  const weiboAvailable = extensions.some(
    (extension) =>
      extension.manifest.id === WEIBO_CHANNEL_EXTENSION_ID &&
      extension.effective &&
      extension.manifest.contributes.deliveryChannels?.includes('weibo') &&
      extension.permissions.some(
        (permission) => permission.key === EXTENSION_PERMISSION.browserHandoffWeibo && permission.granted,
      ),
  );
  return weiboAvailable ? ['wechat', 'weibo'] : ['wechat'];
}

export function naturalWatermarkBrowserCompanionAvailable(extensions: readonly ExtensionDto[]) {
  return extensions.some(
    (extension) => extension.manifest.id === NATURAL_WATERMARK_EXTENSION_ID && extension.effective,
  );
}

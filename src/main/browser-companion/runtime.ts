import { BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';
import {
  BrowserCompanionBrowserController,
  BrowserCompanionLaunchError,
} from '@/main/browser-companion/browser-controller';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import {
  browserCompanionDestinationsResultSchema,
  browserCompanionDeleteResultSchema,
  browserCompanionHistoryResultSchema,
  browserCompanionOpenResultSchema,
  browserCompanionStageResultSchema,
  type BrowserCompanionBrowserId,
  type BrowserCompanionDeleteInput,
  type BrowserCompanionDeleteResult,
  type BrowserCompanionDestinationsResult,
  type BrowserCompanionHistoryItem,
  type BrowserCompanionOpenResult,
  type BrowserCompanionStageInput,
  type BrowserCompanionStageResult,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';

const TARGET_URLS: Record<BrowserCompanionTarget, string> = {
  chatgpt: 'https://chatgpt.com/',
  wechat: 'https://mp.weixin.qq.com/',
  weibo: 'https://weibo.com/',
};

function launchUrl(target: BrowserCompanionTarget, handoffId: string): string {
  const url = new URL(TARGET_URLS[target]);
  url.hash = `aiy-handoff=${handoffId}`;
  return url.toString();
}

export class BrowserCompanionRuntime {
  constructor(
    private readonly handoffs: BrowserCompanionHandoffStore,
    private readonly browser: BrowserCompanionBrowserController,
    private readonly resolveAssetFile: (assetId: string) => ResolvedAssetFile | null,
  ) {}

  async stage(input: BrowserCompanionStageInput): Promise<BrowserCompanionStageResult> {
    const media = (input.mediaAssetIds ?? []).map((assetId) => {
      const file = this.resolveAssetFile(assetId);
      if (!file) throw new Error(`Browser companion image is unavailable: ${assetId}`);
      if (!file.mimeType.startsWith('image/')) {
        throw new Error(`Browser companion media is not an image: ${assetId}`);
      }
      return file;
    });
    const handoff = await this.handoffs.stage(input, media);
    let browserOpened = true;
    let browserOpenError: BrowserCompanionStageResult['browserOpenError'] = null;
    try {
      await this.browser.open(handoff.target, launchUrl(handoff.target, handoff.handoffId));
    } catch (reason) {
      browserOpened = false;
      browserOpenError = reason instanceof BrowserCompanionLaunchError ? reason.code : 'LAUNCH_FAILED';
    }
    return browserCompanionStageResultSchema.parse({ handoff, browserOpened, browserOpenError });
  }

  async open(target: BrowserCompanionTarget): Promise<BrowserCompanionOpenResult> {
    let browserOpened = true;
    let browserOpenError: BrowserCompanionOpenResult['browserOpenError'] = null;
    try {
      await this.browser.open(target, TARGET_URLS[target]);
    } catch (reason) {
      browserOpened = false;
      browserOpenError = reason instanceof BrowserCompanionLaunchError ? reason.code : 'LAUNCH_FAILED';
    }
    return browserCompanionOpenResultSchema.parse({ browserOpened, browserOpenError });
  }

  async destinations(): Promise<BrowserCompanionDestinationsResult> {
    return browserCompanionDestinationsResultSchema.parse(await this.browser.destinations());
  }

  async selectDestination(
    target: BrowserCompanionTarget,
    browserId: BrowserCompanionBrowserId,
    profileDirectory: string,
  ): Promise<BrowserCompanionDestinationsResult> {
    return browserCompanionDestinationsResultSchema.parse(
      await this.browser.select(target, browserId, profileDirectory),
    );
  }

  async history(): Promise<BrowserCompanionHistoryItem[]> {
    return browserCompanionHistoryResultSchema.parse(await this.handoffs.listHistory());
  }

  async delete(input: BrowserCompanionDeleteInput): Promise<BrowserCompanionDeleteResult> {
    return browserCompanionDeleteResultSchema.parse(await this.handoffs.deleteHistory(input.handoffIds));
  }
}

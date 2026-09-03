import { BrowserCompanionHandoffStore, type BrowserCompanionMediaSource } from '@/main/browser-companion/handoff-store';
import {
  BrowserCompanionBrowserController,
  BrowserCompanionLaunchError,
} from '@/main/browser-companion/browser-controller';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import type { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import type { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
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

interface NaturalWatermarkRuntime {
  configuration: NaturalWatermarkConfigurationStore;
  service: NaturalWatermarkService;
  isActivated(): boolean;
}

function launchUrl(target: BrowserCompanionTarget, handoffId: string): string {
  const url = new URL(TARGET_URLS[target]);
  url.hash = `aiy-handoff=${handoffId}`;
  return url.toString();
}

function fileMediaSource(file: ResolvedAssetFile): BrowserCompanionMediaSource {
  return {
    kind: 'file',
    absolutePath: file.absolutePath,
    suggestedName: file.suggestedName,
    mimeType: file.mimeType,
  };
}

async function watermarkedMediaSources(
  files: readonly ResolvedAssetFile[],
  runtime: NaturalWatermarkRuntime,
): Promise<BrowserCompanionMediaSource[]> {
  const configuration = await runtime.configuration.get();
  return Promise.all(
    files.map(async (file) => ({
      kind: 'bytes' as const,
      ...(await runtime.service.apply(file, configuration)),
    })),
  );
}

export class BrowserCompanionRuntime {
  constructor(
    private readonly handoffs: BrowserCompanionHandoffStore,
    private readonly browser: BrowserCompanionBrowserController,
    private readonly resolveAssetFile: (assetId: string) => ResolvedAssetFile | null,
    private readonly naturalWatermark?: NaturalWatermarkRuntime,
  ) {}

  async stage(input: BrowserCompanionStageInput): Promise<BrowserCompanionStageResult> {
    const resolvedMedia = (input.mediaAssetIds ?? []).map((assetId) => {
      const file = this.resolveAssetFile(assetId);
      if (!file) throw new Error(`Browser companion image is unavailable: ${assetId}`);
      if (!file.mimeType.startsWith('image/')) {
        throw new Error(`Browser companion media is not an image: ${assetId}`);
      }
      return file;
    });
    const naturalWatermark = this.naturalWatermark?.isActivated() ? this.naturalWatermark : null;
    const media = naturalWatermark
      ? await watermarkedMediaSources(resolvedMedia, naturalWatermark)
      : resolvedMedia.map(fileMediaSource);
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

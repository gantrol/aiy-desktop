import { randomUUID } from 'node:crypto';
import { selectedWatermarkProfile, type NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import type { BrowserCompanionBatchRecord } from '@/main/browser-companion/batch-store';
import { BrowserCompanionHandoffStore, type BrowserCompanionMediaSource } from '@/main/browser-companion/handoff-store';
import {
  BrowserCompanionBrowserController,
  BrowserCompanionLaunchError,
} from '@/main/browser-companion/browser-controller';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import {
  naturalWatermarkConfigurationSchema,
  naturalWatermarkProfileSchema,
  type NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';
import {
  browserCompanionDestinationsResultSchema,
  browserCompanionDeleteResultSchema,
  browserCompanionDeleteInputSchema,
  browserCompanionHistoryResultSchema,
  browserCompanionOpenResultSchema,
  browserCompanionStageResultSchema,
  browserCompanionStageInputSchema,
  browserCompanionStageErrorCodeSchema,
  browserCompanionBatchInputSchema,
  browserCompanionBatchResultSchema,
  type BrowserCompanionBatchInput,
  type BrowserCompanionBatchResult,
  type BrowserCompanionDestination,
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
  x: 'https://x.com/compose/post',
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image',
};

type BatchWatermark = { profile: NaturalWatermarkProfile | null } | { error: unknown };

function usesWatermark(input: BrowserCompanionStageInput): boolean {
  return Boolean(input.mediaAssetIds?.length && input.watermark && input.watermark.kind !== 'NONE');
}

function launchUrl(
  target: BrowserCompanionTarget,
  handoffId: string,
  contentKind: BrowserCompanionStageInput['contentKind'],
  batch?: { batchId: string; title?: string },
): string {
  const url = new URL(TARGET_URLS[target]);
  url.hash = `aiy-handoff=${handoffId}`;
  if (target === 'wechat') url.hash += `&aiy-content=${contentKind}`;
  if (batch) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set('aiy-batch', batch.batchId);
    fragment.set('aiy-batch-title', batch.title ?? 'AIY');
    url.hash = fragment.toString();
  }
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
  profile: NaturalWatermarkProfile,
): Promise<BrowserCompanionMediaSource[]> {
  return Promise.all(
    files.map(async (file) => ({
      kind: 'bytes' as const,
      ...(await runtime.service.apply(file, profile)),
    })),
  );
}

export class BrowserCompanionRuntime {
  private pendingMutation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly handoffs: BrowserCompanionHandoffStore,
    private readonly browser: BrowserCompanionBrowserController,
    private readonly resolveAssetFile: (assetId: string) => ResolvedAssetFile | null,
    private readonly naturalWatermark?: NaturalWatermarkRuntime,
    private readonly calendarLibraryId?: (source: BrowserCompanionStageInput['source']) => string,
  ) {}

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.pendingMutation.then(operation);
    this.pendingMutation = pending.catch(() => undefined);
    return pending;
  }

  private async freezeBatchWatermarks(inputs: readonly BrowserCompanionStageInput[]): Promise<BatchWatermark[]> {
    if (!inputs.some(usesWatermark)) return inputs.map(() => ({ profile: null }));
    try {
      if (!this.naturalWatermark?.isActivated())
        throw new Error('Natural Watermark is disabled or missing permissions');
      // One validated copy resolves both PREFERRED and PROFILE against the same configuration revision.
      const configuration = naturalWatermarkConfigurationSchema.parse(await this.naturalWatermark.configuration.get());
      return inputs.map((input) => {
        if (!usesWatermark(input)) return { profile: null };
        const id = input.watermark?.kind === 'PROFILE' ? input.watermark.profileId : configuration.preferredProfileId;
        const profile = configuration.profiles.find((candidate) => candidate.id === id);
        return profile
          ? { profile: naturalWatermarkProfileSchema.parse(profile) }
          : { error: new Error('Watermark profile is unavailable') };
      });
    } catch (error) {
      return inputs.map((input) => (usesWatermark(input) ? { error } : { profile: null }));
    }
  }

  private async prepare(
    input: BrowserCompanionStageInput,
    batchId?: string,
    frozenWatermark?: NaturalWatermarkProfile | null,
  ): Promise<BrowserCompanionHistoryItem> {
    const calendarLibraryId = this.calendarLibraryId?.(input.source);
    const resolvedMedia = (input.mediaAssetIds ?? []).map((assetId) => {
      const file = this.resolveAssetFile(assetId);
      if (!file) throw new Error(`Browser companion image is unavailable: ${assetId}`);
      if (!file.mimeType.startsWith('image/')) {
        throw new Error(`Browser companion media is not an image: ${assetId}`);
      }
      return file;
    });
    const watermarkProfile =
      frozenWatermark !== undefined
        ? frozenWatermark
        : resolvedMedia.length
          ? await selectedWatermarkProfile(input.watermark, this.naturalWatermark)
          : null;
    if (frozenWatermark && !this.naturalWatermark?.isActivated()) {
      throw new Error('Natural Watermark is disabled or missing permissions');
    }
    const media =
      watermarkProfile && this.naturalWatermark
        ? await watermarkedMediaSources(resolvedMedia, this.naturalWatermark, watermarkProfile)
        : resolvedMedia.map(fileMediaSource);
    return this.handoffs.stage(input, media, batchId, calendarLibraryId);
  }

  private async openHandoff(
    handoff: BrowserCompanionHistoryItem,
    destination?: BrowserCompanionDestination | null,
    title?: string,
    canStage: (target: BrowserCompanionTarget) => boolean = () => true,
  ): Promise<BrowserCompanionStageResult> {
    if (!canStage(handoff.target)) throw new Error('HANDOFF_NOT_ALLOWED');
    let browserOpened = true;
    let browserOpenError: BrowserCompanionStageResult['browserOpenError'] = null;
    try {
      const batch = handoff.batchId ? { batchId: handoff.batchId, title } : undefined;
      await this.browser.open(
        handoff.target,
        launchUrl(handoff.target, handoff.handoffId, handoff.contentKind, batch),
        destination,
      );
    } catch (reason) {
      browserOpened = false;
      browserOpenError = reason instanceof BrowserCompanionLaunchError ? reason.code : 'LAUNCH_FAILED';
    }
    return browserCompanionStageResultSchema.parse({
      handoff,
      browserOpened,
      browserOpenError,
    });
  }

  async stage(
    rawInput: BrowserCompanionStageInput,
    canStage: (target: BrowserCompanionTarget) => boolean = () => true,
  ): Promise<BrowserCompanionStageResult> {
    const input = browserCompanionStageInputSchema.parse(rawInput);
    return this.mutate(async () => {
      if (!canStage(input.target)) throw new Error('HANDOFF_NOT_ALLOWED');
      return this.openHandoff(await this.prepare(input), undefined, undefined, canStage);
    });
  }

  async stageBatch(
    rawInput: BrowserCompanionBatchInput,
    canStage: (target: BrowserCompanionTarget) => boolean = () => true,
  ): Promise<BrowserCompanionBatchResult> {
    // Parsing makes a fresh, bounded snapshot before any async operation or launch.
    const input = browserCompanionBatchInputSchema.parse(rawInput);
    return this.mutate(() => {
      this.assertExpectedSpace(input.expectedSpaceId, input.items[0].source);
      return this.stageBatchSnapshot(input, canStage);
    });
  }

  private assertExpectedSpace(expectedSpaceId: string | undefined, source: BrowserCompanionStageInput['source']) {
    if (!expectedSpaceId) return;
    let matches = false;
    try {
      matches = this.calendarLibraryId?.(source) === expectedSpaceId;
    } catch {
      // Missing sources and a changed active library both fail before admission.
    }
    if (!matches) throw new Error('BROWSER_COMPANION_LIBRARY_CHANGED');
  }

  private async stageBatchSnapshot(
    input: BrowserCompanionBatchInput,
    canStage: (target: BrowserCompanionTarget) => boolean,
  ): Promise<BrowserCompanionBatchResult> {
    const routes = browserCompanionDestinationsResultSchema.parse(await this.browser.destinations()).routes;
    const batch: BrowserCompanionBatchRecord = {
      schemaVersion: 1,
      batchId: randomUUID(),
      createdAt: new Date().toISOString(),
      source: input.items[0].source,
      input,
      destinations: {
        weibo: routes.weibo,
        wechat: routes.wechat,
        x: routes.x,
        xiaohongshu: routes.xiaohongshu,
      },
      items: input.items.map((item) => ({
        target: item.target as BrowserCompanionBatchResult['items'][number]['target'],
        result: null,
        errorCode: 'NOT_ATTEMPTED',
      })),
    };
    await this.handoffs.batches.save(batch);
    const watermarks = await this.freezeBatchWatermarks(input.items);
    for (const [index, candidate] of input.items.entries()) {
      const item = batch.items[index];
      if (!canStage(candidate.target)) {
        item.errorCode = 'HANDOFF_NOT_ALLOWED';
        await this.handoffs.batches.save(batch);
        continue;
      }
      let handoff: BrowserCompanionHistoryItem;
      try {
        const watermark = watermarks[index];
        if ('error' in watermark) throw watermark.error;
        handoff = await this.prepare(candidate, batch.batchId, watermark.profile);
      } catch (reason) {
        item.errorCode =
          browserCompanionStageErrorCodeSchema.safeParse(reason instanceof Error ? reason.message : reason).data ??
          'STAGE_FAILED';
        await this.handoffs.batches.save(batch);
        continue;
      }
      // Persist the exact handoff before opening it: interruption must not cause a new task on retry.
      item.result = { handoff, browserOpened: false, browserOpenError: null };
      item.errorCode = 'OPEN_NOT_CONFIRMED';
      await this.handoffs.batches.save(batch);
      try {
        item.result = await this.openHandoff(handoff, batch.destinations[item.target], input.title, canStage);
        item.errorCode = null;
      } catch (reason) {
        if (!(reason instanceof Error) || reason.message !== 'HANDOFF_NOT_ALLOWED') throw reason;
        item.errorCode = 'HANDOFF_NOT_ALLOWED';
      }
      await this.handoffs.batches.save(batch);
    }
    return this.batchResult(batch);
  }

  private batchResult(batch: BrowserCompanionBatchRecord): BrowserCompanionBatchResult {
    return browserCompanionBatchResultSchema.parse({
      batchId: batch.batchId,
      createdAt: batch.createdAt,
      source: batch.source,
      items: batch.items,
    });
  }

  async batchHistory(): Promise<BrowserCompanionBatchResult[]> {
    const [batches, history] = await Promise.all([this.handoffs.batches.list(), this.history()]);
    const byId = new Map(history.map((handoff) => [handoff.handoffId, handoff]));
    const byBatchTarget = new Map<string, BrowserCompanionHistoryItem | null>();
    for (const handoff of history) {
      if (!handoff.batchId) continue;
      const key = `${handoff.batchId}:${handoff.target}`;
      byBatchTarget.set(key, byBatchTarget.has(key) ? null : handoff);
    }
    return batches.map((batch) => {
      for (const item of batch.items) {
        const handoff = item.result
          ? byId.get(item.result.handoff.handoffId)
          : byBatchTarget.get(`${batch.batchId}:${item.target}`);
        // Interrupted writes can be recovered only when one exact candidate remains, never by recency.
        if (!handoff || handoff.batchId !== batch.batchId || handoff.target !== item.target) continue;
        const hadResult = Boolean(item.result);
        item.result = {
          ...(item.result ?? { browserOpened: false, browserOpenError: null }),
          handoff,
        };
        if (handoff.state !== 'ready') item.errorCode = null;
        else if (!hadResult) item.errorCode = 'OPEN_NOT_CONFIRMED';
      }
      return this.batchResult(batch);
    });
  }

  async reopen(
    handoffId: string,
    canStage: (target: BrowserCompanionTarget) => boolean = () => true,
    expectedSpaceId?: string,
  ): Promise<BrowserCompanionStageResult> {
    return this.mutate(() => this.reopenHandoff(handoffId, canStage, expectedSpaceId));
  }

  private async reopenHandoff(
    handoffId: string,
    canStage: (target: BrowserCompanionTarget) => boolean,
    expectedSpaceId?: string,
  ): Promise<BrowserCompanionStageResult> {
    const handoff = (await this.history()).find((candidate) => candidate.handoffId === handoffId);
    if (!handoff) throw new Error('HANDOFF_NOT_FOUND');
    this.assertExpectedSpace(expectedSpaceId, handoff.source);
    if (handoff.state !== 'ready') throw new Error('HANDOFF_ALREADY_CLAIMED_OR_DELIVERED');
    if (!canStage(handoff.target)) throw new Error('HANDOFF_NOT_ALLOWED');
    const batch = handoff.batchId ? await this.handoffs.batches.get(handoff.batchId) : null;
    const item = batch?.items.find((candidate) => candidate.target === handoff.target);
    const destination = batch && item ? batch.destinations[item.target] : undefined;
    let result: BrowserCompanionStageResult;
    try {
      result = await this.openHandoff(handoff, destination ?? undefined, batch?.input.title, canStage);
    } catch (reason) {
      if (batch && item && reason instanceof Error && reason.message === 'HANDOFF_NOT_ALLOWED') {
        item.errorCode = 'HANDOFF_NOT_ALLOWED';
        item.result = { handoff, browserOpened: false, browserOpenError: null };
        await this.handoffs.batches.save(batch);
      }
      throw reason;
    }
    if (batch && item) {
      item.result = result;
      item.errorCode = null;
      await this.handoffs.batches.save(batch);
    }
    return result;
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
    return browserCompanionOpenResultSchema.parse({
      browserOpened,
      browserOpenError,
    });
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

  async delete(rawInput: BrowserCompanionDeleteInput): Promise<BrowserCompanionDeleteResult> {
    const input = browserCompanionDeleteInputSchema.parse(rawInput);
    return this.mutate(async () => {
      if ('handoffIds' in input) {
        const result = browserCompanionDeleteResultSchema.parse(await this.handoffs.deleteHistory(input.handoffIds));
        return result;
      }
      // Resolve actual records by batch and target, including a handoff staged before its receipt was saved.
      // Never follow a stale receipt's handoff ID into another batch.
      const [handoffs, pendingDeletionIds] = await Promise.all([
        this.handoffs.listHistory(input),
        this.handoffs.deletedBatchHandoffIds(input),
      ]);
      const result = browserCompanionDeleteResultSchema.parse(
        await this.handoffs.deleteHistory([...handoffs.map((item) => item.handoffId), ...pendingDeletionIds]),
      );
      // Delete the frozen candidate even when staging failed and no handoff ever existed.
      await this.handoffs.batches.deleteItems(input.batchId, input.targets);
      return result;
    });
  }
}

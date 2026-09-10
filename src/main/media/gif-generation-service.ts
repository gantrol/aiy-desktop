import { randomUUID } from 'node:crypto';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation/service';
import type { CodexService } from '@/main/assistant/codex-service';
import { gifPlanSequence, gifPlanTimings, type GifPlanRequest } from '@/shared/contracts/gif-motion-plan';
import type { GifGenerationStart, GifGenerationProgress, GifGenerationState } from '@/shared/contracts/gif-generation';
import { GIF_MAX_SOURCE_BYTES, gifErrorCode, gifManifestSchema } from '@/shared/contracts/gif-making';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { gifSourceInfo } from '@/main/media/gif-source';
import { processGifFrames, processGifFrameResult } from '@/main/media/gif-frame-processor';
import { gifGenerationPrompt } from '@/main/media/gif-generation-prompt';
import type { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';

interface ActiveGeneration {
  id: string;
  documentId: string;
  root: string;
  controller: AbortController;
  modelRunId: string | null;
  check: (() => void) | null;
}
export class GifGenerationService {
  private active: ActiveGeneration | null = null;
  constructor(
    private readonly database: LibraryDatabase,
    private readonly generation: GenerationService,
    private readonly codex: CodexService,
    private readonly assistantRouting: AssistantRoutingConfiguration,
  ) {
    generation.on('changed', (event) => {
      if (this.active?.modelRunId === event.runId) this.active.check?.();
    });
  }
  routes() {
    return this.generation.imageGenerationRoutes.filter(
      (r) => !r.internal && r.capabilities.includes('IMAGE_EDIT') && r.capabilities.includes('REFERENCE_IMAGE'),
    );
  }
  async plan(input: GifPlanRequest) {
    if (this.active) throw new Error('GIF_BUSY');
    const active: ActiveGeneration = {
      id: input.id,
      documentId: input.documentId,
      root: this.database.libraryRoot,
      controller: new AbortController(),
      modelRunId: null,
      check: null,
    };
    this.active = active;
    try {
      const execution = this.assistantRouting.resolve('gifPlanning');
      if (execution.providerKey !== 'codex' || !execution.reasoningEffort) {
        throw new Error('GIF_PLANNING_MODEL_UNAVAILABLE');
      }
      const result = await this.codex.planGif(
        input,
        { model: execution.modelKey, effort: execution.reasoningEffort },
        active.controller.signal,
      );
      this.assertActive(active);
      return result;
    } catch (reason) {
      if (active.controller.signal.aborted) throw new Error('GIF_CANCELLED');
      const providerCode =
        reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : '';
      if (
        providerCode === 'VIDEO_DOCUMENT_MODEL_UNAVAILABLE' ||
        providerCode === 'VIDEO_DOCUMENT_REASONING_UNAVAILABLE'
      ) {
        throw new Error('GIF_PLANNING_MODEL_UNAVAILABLE', { cause: reason });
      }
      const code = gifErrorCode(reason);
      if (code !== 'GIF_FAILED') throw new Error(code, { cause: reason });
      throw new Error('GIF_PLAN_FAILED', { cause: reason });
    } finally {
      if (this.active === active) this.active = null;
    }
  }
  async cancel(id: string) {
    const active = this.active;
    if (!active || active.id !== id || active.root !== this.database.libraryRoot) return;
    active.controller.abort(new Error('GIF_CANCELLED'));
    if (active.modelRunId) await this.generation.cancel(active.modelRunId);
  }
  private assertActive(active: ActiveGeneration) {
    active.controller.signal.throwIfAborted();
    if (active.root !== this.database.libraryRoot) throw new Error('GIF_CANCELLED');
    this.database.assertGifDocumentAvailable(active.documentId);
  }
  private async readAsset(id: string, active: ActiveGeneration) {
    this.assertActive(active);
    const file = (await this.database.resolveAssetFilesAsync([id])).get(id);
    if (!file) throw new Error('GIF_ASSET_UNAVAILABLE');
    const bytes = await readBoundedImageFile(file.absolutePath, active.controller.signal, GIF_MAX_SOURCE_BYTES);
    gifSourceInfo(bytes);
    return bytes;
  }
  private async storeImage(bytes: Uint8Array, sources: string[], active: ActiveGeneration, generationRunId?: string) {
    this.assertActive(active);
    gifSourceInfo(bytes);
    const stored = await this.database.storeGifSourceBuffer(bytes, '.png');
    this.assertActive(active);
    return this.database.storeGifGenerationAsset(active.id, stored, sources, generationRunId);
  }
  private waitForModel(active: ActiveGeneration): Promise<string> {
    return new Promise((resolve, reject) => {
      const signal = active.controller.signal;
      let finished = false;
      const finish = (error?: Error, assetId?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        active.check = null;
        if (error) reject(error);
        else resolve(assetId!);
      };
      const abort = () => finish(new Error('GIF_CANCELLED'));
      const timeout = setTimeout(() => finish(new Error('GIF_GENERATION_FAILED')), 20 * 60 * 1000);
      active.check = () => {
        try {
          this.assertActive(active);
          const result = this.database.gifGenerationModelResult(active.modelRunId!);
          if (!result) throw new Error('GIF_GENERATION_FAILED');
          if (result.status === 'SUCCEEDED' && result.assetId) finish(undefined, result.assetId);
          else if (['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(result.status)) {
            const codes: Record<string, string> = {
              IMAGE_GENERATION_BLOCKED: 'GIF_GENERATION_BLOCKED',
              IMAGE_GENERATION_CANCELLED: 'GIF_CANCELLED',
              IMAGE_GENERATION_NO_OUTPUT: 'GIF_GENERATION_NO_OUTPUT',
              IMAGE_GENERATION_INVALID_OUTPUT: 'GIF_GENERATION_INVALID_OUTPUT',
            };
            finish(
              new Error(
                result.status === 'CANCELLED'
                  ? 'GIF_CANCELLED'
                  : (codes[result.errorCode ?? ''] ?? 'GIF_GENERATION_FAILED'),
              ),
            );
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error('GIF_GENERATION_FAILED'));
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      active.check();
    });
  }
  async generate(input: GifGenerationStart, progress: (value: GifGenerationProgress) => void) {
    if (!input.settings.plan) throw new Error('GIF_PLAN_REQUIRED');
    if (this.active) throw new Error('GIF_BUSY');
    const route = this.routes().find((r) => r.key === input.settings.modelKey && r.state === 'READY');
    if (!route || (route.qualityMode === 'SELECTABLE' && !route.supportedQualities.includes(input.settings.quality)))
      throw new Error('GIF_MODEL_UNAVAILABLE');
    const { document, assets } = this.database.loadGifDocument(input.documentId);
    const source = assets.find((a) => a.id === input.settings.sourceAssetId);
    if (!source) throw new Error('GIF_ASSET_UNAVAILABLE');
    if (source.width > 2048 || source.height > 2048) throw new Error('GIF_LIMIT');
    if (route.maxReferenceImages !== null && route.maxReferenceImages < (input.settings.mode === 'REGION' ? 2 : 1))
      throw new Error('GIF_MODEL_UNAVAILABLE');
    const active: ActiveGeneration = {
      id: input.id,
      documentId: input.documentId,
      root: this.database.libraryRoot,
      controller: new AbortController(),
      modelRunId: null,
      check: null,
    };
    this.database.beginGifGeneration(input);
    this.active = active;
    const stage = (state: GifGenerationState) => {
      this.assertActive(active);
      this.database.updateGifGeneration(input.id, state);
      progress({ id: input.id, documentId: input.documentId, state });
    };
    try {
      stage('PREPARING');
      const bytes = await this.readAsset(source.id, active);
      const prepared = await processGifFrames(
        { runId: input.id, operation: 'PREPARE', settings: input.settings, source: bytes, sheet: null },
        active.controller.signal,
      );
      const references = [];
      for (const image of prepared) references.push(await this.storeImage(image, [source.id], active));
      this.assertActive(active);
      const individual = input.settings.generationMode === 'FRAMES';
      const totalRequests = individual ? input.settings.keyframes - 1 : 1;
      const generatedIds: string[] = [];
      const generatedRunIds: string[] = [];
      const generatedImages: Uint8Array<ArrayBuffer>[] = [];
      let inputBytes = bytes.byteLength;
      // Keep a single active model request and a bounded compressed-image budget.
      for (let index = 0; index < totalRequests; index++) {
        this.assertActive(active);
        const prompt = gifGenerationPrompt(
          input.settings,
          source.width,
          source.height,
          individual ? index + 1 : undefined,
        );
        const launched = await this.generation.start({
          seriesId: this.database.gifExecutionSeries(document.id),
          sourceAssetId: references[0].id,
          title: document.title || 'GIF',
          titleLocale: input.titleLocale,
          manualPrompt: prompt,
          prompt,
          changeSummary: input.settings.prompt.slice(0, 1000),
          referenceAssetIds: references.map((a) => a.id),
          termIds: [],
          wordPaletteReferences: [],
          modelKey: route.key,
          canvasPresetKey: null,
          width: null,
          height: null,
          quality: input.settings.quality,
        });
        active.modelRunId = launched.runId;
        this.assertActive(active);
        this.database.updateGifGeneration(input.id, 'GENERATING', { generationRunId: launched.runId });
        progress({
          id: input.id,
          documentId: input.documentId,
          state: 'GENERATING',
          completedRequests: index,
          totalRequests,
        });
        const imageId = await this.waitForModel(active);
        this.assertActive(active);
        this.database.referenceGifGenerationAsset(input.id, imageId);
        const image = await this.readAsset(imageId, active);
        inputBytes += image.byteLength;
        if (inputBytes > GIF_MAX_SOURCE_BYTES) throw new Error('GIF_LIMIT');
        generatedIds.push(imageId);
        generatedRunIds.push(launched.runId);
        generatedImages.push(image);
        progress({
          id: input.id,
          documentId: input.documentId,
          state: 'GENERATING',
          completedRequests: index + 1,
          totalRequests,
        });
      }
      stage('COMPOSITING');
      const rendered = await processGifFrameResult(
        {
          runId: input.id,
          operation: 'COMPOSE',
          settings: input.settings,
          source: bytes,
          sheet: individual ? null : generatedImages[0],
          frameImages: individual ? generatedImages : undefined,
        },
        active.controller.signal,
      );
      const sequence = gifPlanSequence(input.settings.plan);
      const durations = gifPlanTimings(input.settings.plan);
      const frames = [{ id: randomUUID(), assetId: source.id, sourceRect: null, durationMs: durations[0] }];
      for (const [i, image] of rendered.images.entries()) {
        const asset = await this.storeImage(
          image,
          [source.id, generatedIds[individual ? i : 0]],
          active,
          generatedRunIds[individual ? i : 0],
        );
        frames.push({ id: randomUUID(), assetId: asset.id, sourceRect: null, durationMs: durations[i + 1] });
      }
      const manifest = gifManifestSchema.parse({
        ...document.manifest,
        frames: sequence.map((state, i) => ({ ...frames[state], id: randomUUID(), durationMs: durations[i] })),
        playback: 'FORWARD',
        loop: input.settings.plan.returnMode === 'ONE_WAY' ? 'ONCE' : 'FOREVER',
      });
      this.assertActive(active);
      this.database.updateGifGeneration(input.id, 'READY', { manifest, audit: rendered.audit ?? undefined });
      progress({ id: input.id, documentId: input.documentId, state: 'READY' });
      return this.database.loadGifGeneration(input.id);
    } catch (reason) {
      const code = gifErrorCode(reason);
      if (active.modelRunId) await Promise.resolve(this.generation.cancel(active.modelRunId)).catch(() => undefined);
      if (active.root === this.database.libraryRoot)
        this.database.updateGifGeneration(input.id, code === 'GIF_CANCELLED' ? 'CANCELLED' : 'FAILED', {
          errorCode: code,
        });
      throw new Error(code, { cause: reason });
    } finally {
      if (this.active === active) this.active = null;
    }
  }
}

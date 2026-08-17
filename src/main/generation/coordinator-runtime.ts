import { EventEmitter } from 'node:events';
import type {
  GenerationChangedEvent,
  GenerationInput,
  GenerationTaskDto,
  GenerationTaskPhase,
  ImageGenerationConcurrencyDto,
  ImageGenerationRouteDto,
  PromptCommonInputDto,
} from '@/shared/contracts';
import { LibraryDatabase } from '@/main/database';
import {
  type GenerationExecutionSignal,
  type GenerationModelResult,
  ImageGenerationRouteRegistry,
} from '@/main/generation-models';
import { GenerationAdmissionScheduler } from '@/main/generation/admission-scheduler';
import { persistedGenerationErrorDetails } from '@/main/generation/error-details';
import type { PendingGeneration, PendingGenerationLaunch } from '@/main/generation/task-state';
import { buildImageEditPrompt } from '@/main/image-edit/image-edit-planner';
import { snapshotImageGenerationRoute } from '@/shared/image-generation-route-identity';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT } from '@/shared/image-generation-concurrency';

interface GenerationExecutionState {
  cleanup: (() => void) | null;
  fileOutputReady: boolean;
  outputCommitted: boolean;
}

export class GenerationCoordinatorRuntime extends EventEmitter {
  protected readonly pending = new Map<string, PendingGeneration>();

  protected readonly admissionScheduler: GenerationAdmissionScheduler<PendingGeneration>;

  protected nextSequence = 0;

  protected disposed = false;

  constructor(
    protected readonly database: LibraryDatabase,
    protected readonly routesRegistry: ImageGenerationRouteRegistry,
    defaultMaxConcurrentPerModel = DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT,
  ) {
    super();
    this.admissionScheduler = new GenerationAdmissionScheduler(defaultMaxConcurrentPerModel);
  }

  get hasPending() {
    return this.pending.size > 0;
  }

  get imageGenerationRoutes() {
    return this.routesRegistry.list().map((route) => this.routeDescriptor(route));
  }

  configureConcurrency(configuration: ImageGenerationConcurrencyDto) {
    this.admissionScheduler.configure(configuration);
    for (const task of this.pending.values()) {
      task.maxConcurrent = this.admissionScheduler.maxConcurrent(task.modelKey);
    }
    this.drainQueue();
  }

  get workerStatus() {
    return {
      state: 'CONNECTED' as const,
      workerId: 'in-process',
      generationTaskCount: this.pending.size,
      codexTaskCount: 0,
    };
  }

  get tasks(): GenerationTaskDto[] {
    const queuePositionByRoute = new Map<string, number>();
    return [...this.pending.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((task) => {
        let queuePosition: number | null = null;
        if (task.status === 'QUEUED') {
          queuePosition = (queuePositionByRoute.get(task.modelKey) ?? 0) + 1;
          queuePositionByRoute.set(task.modelKey, queuePosition);
        }
        return {
          runId: task.runId,
          seriesId: task.seriesId,
          versionId: task.versionId,
          modelKey: task.input.modelKey,
          batchId: task.batchId,
          batchPosition: task.batchPosition,
          batchTotal: task.batchTotal,
          batchModelKeys: task.batchModelKeys,
          status: task.status,
          phase: task.phase,
          progress: task.progress,
          queuePosition,
          submittedAt: task.submittedAt,
          startedAt: task.startedAt,
          updatedAt: task.updatedAt,
        };
      });
  }

  protected launch(input: PendingGenerationLaunch) {
    this.launchBatch([input]);
  }

  protected launchBatch(inputs: readonly PendingGenerationLaunch[]) {
    try {
      for (const input of inputs) this.assertGenerationInput(input.input);
    } catch (error) {
      for (const input of inputs) {
        this.database.markRun(input.runId, 'CANCELLED', undefined, 'GENERATION_ADMISSION_REJECTED');
      }
      throw error;
    }
    let changedRunId: string | null = null;
    try {
      for (const input of inputs) {
        const task = this.enqueue(input);
        changedRunId ??= task.runId;
      }
    } finally {
      if (changedRunId) {
        this.emitChanged(changedRunId);
        this.drainQueue();
      }
    }
  }

  protected enqueue(input: PendingGenerationLaunch) {
    let route: PendingGeneration['route'];
    try {
      route = this.routesRegistry.get(input.input.modelKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image-generation route is unavailable';
      this.database.markRun(input.runId, 'CANCELLED', message, 'GENERATION_ROUTE_UNAVAILABLE');
      throw error;
    }
    const routeDescriptor = this.routeDescriptor(route.descriptor);
    const submittedAt = new Date().toISOString();
    const task: PendingGeneration = {
      ...input,
      route,
      routeDescriptor,
      modelKey: routeDescriptor.key,
      maxConcurrent: this.admissionScheduler.maxConcurrent(routeDescriptor.key),
      batchId: input.batchId ?? null,
      batchPosition: input.batchPosition ?? null,
      batchTotal: input.batchTotal ?? null,
      batchModelKeys: input.batchModelKeys ?? [],
      status: 'QUEUED',
      phase: 'QUEUED',
      progress: null,
      cancelExecution: null,
      cancelled: false,
      submittedAt,
      startedAt: null,
      updatedAt: submittedAt,
      sequence: this.nextSequence++,
    };
    this.persistPhase(task);
    this.pending.set(task.runId, task);
    return task;
  }

  protected drainQueue() {
    if (this.disposed) return;
    const queued = [...this.pending.values()]
      .filter((candidate) => candidate.status === 'QUEUED' && !candidate.cancelled)
      .sort((left, right) => left.sequence - right.sequence);
    for (const task of queued) {
      // Event listeners may synchronously cancel work while an earlier task is
      // being admitted, so re-check the snapshot entry before scheduling it.
      if (task.status !== 'QUEUED' || task.cancelled || !this.pending.has(task.runId)) continue;
      if (!this.admissionScheduler.admitNext([task])) continue;
      task.status = 'RUNNING';
      task.startedAt = new Date().toISOString();
      this.database.markRun(task.runId, 'RUNNING');
      this.setPhase(task, 'PREPARING');
      void this.execute(task);
    }
  }

  protected routeDescriptor(route: ImageGenerationRouteDto) {
    return snapshotImageGenerationRoute({
      ...route,
      maxConcurrent: this.admissionScheduler.maxConcurrent(route.key),
    });
  }

  protected async execute(task: PendingGeneration) {
    const state: GenerationExecutionState = {
      cleanup: null,
      fileOutputReady: false,
      outputCommitted: false,
    };
    try {
      const model = task.route;
      const prepared = await model.prepareExecution(task.runId, task.input, task.routeDescriptor);
      state.cleanup = prepared.cleanup ?? null;
      if (this.executionStopped(task)) return;
      this.database.freezeGenerationExecution(
        task.runId,
        task.input,
        task.promptInput,
        task.routeDescriptor,
        prepared.requestSnapshot,
      );
      this.setPhase(task, 'SUBMITTING');
      const result = await prepared.execute(
        (cancelExecution) => {
          task.cancelExecution = cancelExecution ?? null;
          if (task.cancelled || this.disposed) {
            cancelExecution?.();
            return;
          }
          this.setPhase(task, 'GENERATING');
        },
        (signal) => this.onExecutionSignal(task, task.routeDescriptor.providerKey, signal),
      );
      if (this.executionStopped(task)) return;
      // From this point a FILE result is a recoverable local artifact. Any
      // subsequent metadata or database failure must preserve its staging
      // directory for startup reconciliation.
      state.fileOutputReady = result.kind === 'FILE';
      this.persistExecutionMetadata(task, result);
      // Reaching the save phase means the provider has returned, not that the
      // local commit is complete. Preserve provider-reported progress instead
      // of fabricating a task-level 100% while SQLite/object-store work remains.
      this.setPhase(task, 'SAVING');
      this.commitExecutionOutput(task, result);
      state.outputCommitted = true;
    } catch (error) {
      this.recordExecutionFailure(task, error, state);
    } finally {
      this.finishExecution(task, state);
    }
  }

  private executionStopped(task: PendingGeneration) {
    return task.cancelled || this.disposed;
  }

  private persistExecutionMetadata(task: PendingGeneration, result: GenerationModelResult) {
    if (result.providerRequestId) {
      this.recordProviderRequestIdentity(task.runId, task.routeDescriptor.providerKey, result.providerRequestId, {
        checkpoint: result.continuation,
      });
    } else if (result.continuation && typeof this.database.saveGenerationCheckpoint === 'function') {
      this.database.saveGenerationCheckpoint(task.runId, result.continuation, task.progress ?? undefined);
    }
    if (
      result.providerReturnedDescriptions?.length &&
      typeof this.database.recordProviderReturnedDescriptions === 'function'
    ) {
      this.database.recordProviderReturnedDescriptions(task.runId, result.providerReturnedDescriptions);
    }
  }

  private commitExecutionOutput(task: PendingGeneration, result: GenerationModelResult) {
    if (result.kind === 'FILE') {
      this.database.finishGeneration(task.runId, result.outputPath, task.input.sourceAssetId ?? null);
      return;
    }
    this.database.finishGenerationFromAsset(task.runId, result.sourceAssetId, 'MODEL_REPLAY');
  }

  private recordExecutionFailure(task: PendingGeneration, error: unknown, state: GenerationExecutionState) {
    if (this.executionStopped(task)) return;
    const savingFailed = state.fileOutputReady && !state.outputCommitted;
    const reportedErrorCode =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
    const errorCode = reportedErrorCode ?? (savingFailed ? 'OUTPUT_COMMIT_FAILED' : 'GENERATION_FAILED');
    const finalStatus = savingFailed || errorCode === 'LOCAL_STATE' ? 'INTERRUPTED' : 'FAILED';
    const errorMessage = error instanceof Error ? error.message : 'Generation failed';
    const errorDetails = persistedGenerationErrorDetails(error);
    if (errorDetails) this.database.markRun(task.runId, finalStatus, errorMessage, errorCode, errorDetails);
    else this.database.markRun(task.runId, finalStatus, errorMessage, errorCode);
  }

  private finishExecution(task: PendingGeneration, state: GenerationExecutionState) {
    this.cleanupExecution(task, state);
    if (this.disposed) return;
    if (task.cancelled) this.database.markRun(task.runId, 'CANCELLED', undefined, 'USER_CANCELLED');
    this.admissionScheduler.release(task);
    this.pending.delete(task.runId);
    this.emitChanged(task.runId, true);
    this.drainQueue();
  }

  private cleanupExecution(task: PendingGeneration, state: GenerationExecutionState) {
    // Process shutdown is an interruption, not a completed cancellation or
    // failure. Keep the provider job directory intact so startup recovery can
    // validate a result that may have reached disk just before the child exits.
    if (!state.cleanup || this.disposed || (state.fileOutputReady && !state.outputCommitted)) return;
    try {
      state.cleanup();
    } catch (error) {
      console.error('[generation-temp-cleanup]', {
        code: error instanceof Error && 'code' in error ? error.code : 'CLEANUP_FAILED',
        runId: task.runId,
      });
    }
  }

  protected onExecutionSignal(task: PendingGeneration, providerKey: string, signal: GenerationExecutionSignal) {
    if (task.cancelled || this.disposed) return;
    if (signal.type === 'REQUEST_IDENTIFIED' || signal.type === 'REQUEST_ACCEPTED') {
      if (signal.providerRequestId)
        this.recordProviderRequestIdentity(task.runId, providerKey, signal.providerRequestId);
      return;
    }
    if (signal.type === 'REMOTE_OPERATION_ACCEPTED') {
      this.recordProviderRequestIdentity(task.runId, providerKey, signal.providerRequestId, {
        remoteOperationAccepted: true,
      });
      // Persist the remote identity before advertising a waiting state. If the
      // next local write fails, restart reconciliation still has the provider ID.
      this.setPhase(task, 'WAITING_PROVIDER');
      return;
    }
    if (signal.type !== 'PROGRESS') return;
    const phase = signal.stage === 'FINALIZING' ? 'FINALIZING' : signal.stage;
    this.setPhase(task, phase, signal.progress ?? null, signal.message);
  }

  protected recordProviderRequestIdentity(
    runId: string,
    providerKey: string,
    providerRequestId: string,
    evidence: Readonly<{ checkpoint?: unknown; remoteOperationAccepted?: boolean }> = {},
  ) {
    if (typeof this.database.recordGenerationProviderAccepted !== 'function') return;
    this.database.recordGenerationProviderAccepted(runId, {
      providerKey,
      providerRequestId,
      ...(evidence.checkpoint === undefined ? {} : { checkpoint: evidence.checkpoint }),
      ...(evidence.remoteOperationAccepted ? { remoteOperationAccepted: true } : {}),
    });
  }

  protected setPhase(
    task: PendingGeneration,
    phase: GenerationTaskPhase,
    progress: number | null = task.progress,
    message?: string,
  ) {
    task.phase = phase;
    task.progress = progress;
    task.updatedAt = new Date().toISOString();
    this.persistPhase(task, message);
    this.emitChanged(task.runId);
  }

  protected persistPhase(task: PendingGeneration, message?: string) {
    if (typeof this.database.markGenerationPhase !== 'function') return;
    this.database.markGenerationPhase(task.runId, task.phase, task.progress ?? undefined, message);
  }

  protected emitChanged(runId: string, terminal = false) {
    const event: GenerationChangedEvent = { runId, tasks: this.tasks, terminal };
    this.emit('changed', event);
  }

  protected assertModel(modelKey: string) {
    const model = this.routesRegistry.get(modelKey);
    if (model.descriptor.state !== 'READY') {
      throw new Error(`Generation model is unavailable: ${model.descriptor.name}`);
    }
  }

  protected assertGenerationInput(input: Readonly<Pick<GenerationInput, 'modelKey' | 'width' | 'height' | 'quality'>>) {
    const model = this.routesRegistry.get(input.modelKey);
    const route = model.descriptor;
    if (route.state !== 'READY') throw new Error(`Generation model is unavailable: ${route.name}`);
    if ((input.width === null) !== (input.height === null)) {
      throw new Error('Output width and height must both be set or both be omitted');
    }
    if (
      (input.width !== null && (!Number.isInteger(input.width) || input.width <= 0)) ||
      (input.height !== null && (!Number.isInteger(input.height) || input.height <= 0))
    ) {
      throw new Error('Output dimensions must be positive integers');
    }
    if (route.qualityMode === 'SELECTABLE' && !route.supportedQualities.includes(input.quality)) {
      throw new Error(`The selected quality is unavailable for ${route.name}`);
    }
    model.validateInput?.(input, route);
  }

  protected capturePromptInput(
    input: Pick<
      GenerationInput,
      'manualPrompt' | 'promptNodes' | 'termPromptLocale' | 'termIds' | 'wordPaletteReferences' | 'referenceAssetIds'
    >,
  ): PromptCommonInputDto {
    return this.database.capturePromptCommonInput(input);
  }

  protected promptInputForVersion(versionId: string) {
    return this.database.getPromptCommonInput(versionId);
  }

  protected resolveInput(input: GenerationInput, promptInput: PromptCommonInputDto) {
    const route = this.routesRegistry.get(input.modelKey).descriptor;
    return this.database.resolveGenerationInput(input, promptInput, imageGenerationPromptProfileId(route));
  }

  protected withFrozenImageEditPrompt(runId: string, input: GenerationInput) {
    if (typeof this.database.getGenerationEditSpec !== 'function') return input;
    const editSpec = this.database.getGenerationEditSpec(runId);
    if (!editSpec) return input;
    if (input.sourceAssetId && input.sourceAssetId !== editSpec.sourceAssetId) {
      throw new Error('Image edit source does not match the frozen execution spec');
    }
    const model = this.routesRegistry.get(input.modelKey);
    if (!input.sourceAssetId) {
      if (!model.descriptor.capabilities.includes('IMAGE_EDIT')) {
        throw new Error(`${model.descriptor.name} does not support image editing`);
      }
    }
    const usesNativeMask = editSpec.mode === 'MASK' && model.descriptor.capabilities.includes('MASK_EDIT');
    const usesVisibleGuide = !usesNativeMask;
    const promptMode = usesNativeMask ? 'MASK' : 'SEMANTIC';
    if (usesVisibleGuide && !this.database.getGenerationEditGuide(runId)) {
      throw new Error('Image edit range guide is unavailable');
    }
    return {
      ...input,
      sourceAssetId: editSpec.sourceAssetId,
      referenceAssetIds: [
        editSpec.sourceAssetId,
        ...input.referenceAssetIds.filter((assetId) => assetId !== editSpec.sourceAssetId),
      ],
      prompt: buildImageEditPrompt(input.prompt, editSpec.annotations, promptMode, usesVisibleGuide),
    };
  }
}

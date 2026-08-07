import { EventEmitter } from 'node:events';
import { ulid } from 'ulid';
import type {
  CodexImageRefinementInput,
  GenerationBatchInput,
  GenerationChangedEvent,
  GenerationErrorDetailsDto,
  GenerationInput,
  GenerationTaskDto,
  GenerationTaskPhase,
  GenerationVersionInput,
  ImageEditBatchStartInput,
  ImageEditStartInput,
  ImageReframeStartInput,
  PromptCommonInputDto,
  StyleExplorationStartInput,
} from '@/shared/contracts';
import { LibraryDatabase } from '@/main/database';
import { type GenerationExecutionSignal, ImageGenerationRouteRegistry } from '@/main/generation-models';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import type { GenerationService } from '@/main/generation-service';
import {
  buildImageEditPrompt,
  createImageEditGenerationPlan,
  createImageReframeGenerationInput,
} from '@/main/image-edit/image-edit-planner';
import { CODEX_APP_SERVER_IMAGE_MODEL_KEY } from '@/shared/extension-ids';

interface PendingGeneration {
  runId: string;
  seriesId: string;
  versionId: string;
  input: GenerationInput;
  promptInput: PromptCommonInputDto;
  batchId: string | null;
  batchPosition: number | null;
  batchTotal: number | null;
  batchModelKeys: string[];
  status: 'QUEUED' | 'RUNNING';
  phase: GenerationTaskPhase;
  progress: number | null;
  cancelExecution: (() => void) | null;
  cancelled: boolean;
  submittedAt: string;
  startedAt: string | null;
  updatedAt: string;
  sequence: number;
}

type PendingGenerationLaunch = Pick<PendingGeneration, 'runId' | 'seriesId' | 'versionId' | 'input' | 'promptInput'> &
  Partial<Pick<PendingGeneration, 'batchId' | 'batchPosition' | 'batchTotal' | 'batchModelKeys'>>;

function persistedGenerationErrorDetails(error: unknown): GenerationErrorDetailsDto | undefined {
  if (!(error instanceof GenerationAdapterError)) return undefined;
  let metadata: Record<string, unknown> = {};
  try {
    const serialized = JSON.stringify(error.details ?? {});
    if (serialized.length <= 32_000) {
      const parsed = JSON.parse(serialized) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } else {
      metadata = { detailsTruncated: true };
    }
  } catch {
    metadata = { detailsUnavailable: true };
  }
  return {
    retryable: error.retryable,
    providerCode: error.providerCode ?? null,
    metadata,
  };
}

export class GenerationCoordinator extends EventEmitter implements GenerationService {
  private readonly pending = new Map<string, PendingGeneration>();
  private nextSequence = 0;
  private disposed = false;
  private activeCount = 0;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly routesRegistry: ImageGenerationRouteRegistry,
    private readonly maxConcurrent = 3,
  ) {
    super();
  }

  get hasPending() {
    return this.pending.size > 0;
  }

  get imageGenerationRoutes() {
    return this.routesRegistry.list();
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
    let queuePosition = 0;
    return [...this.pending.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((task) => ({
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
        queuePosition: task.status === 'QUEUED' ? ++queuePosition : null,
        submittedAt: task.submittedAt,
        startedAt: task.startedAt,
        updatedAt: task.updatedAt,
      }));
  }

  start(input: GenerationInput) {
    return this.startSingle(input);
  }

  startImageEdit(input: ImageEditStartInput) {
    const batch = this.startImageEditBatch({
      seriesId: input.seriesId,
      sourceAssetId: input.sourceAssetId,
      annotationIds: input.annotationIds,
      targets: [{ modelKey: input.modelKey, count: 1, quality: input.quality }],
      mode: input.mode,
      locale: input.locale,
    });
    return { runId: batch.runIds[0], seriesId: batch.seriesId, versionId: batch.versionId };
  }

  startImageEditBatch(batch: ImageEditBatchStartInput) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    if (!batch.targets.length) throw new Error('Select at least one image editing model');
    const expandedTargets = batch.targets.flatMap((target) => {
      if (!Number.isInteger(target.count) || target.count < 1) throw new Error('Image edit count must be positive');
      const model = this.routesRegistry.get(target.modelKey);
      if (model.descriptor.state !== 'READY') {
        throw new Error(`Generation model is unavailable: ${model.descriptor.name}`);
      }
      if (!model.descriptor.capabilities.includes('IMAGE_EDIT')) {
        throw new Error(`${model.descriptor.name} does not support image editing`);
      }
      return Array.from({ length: target.count }, () => ({
        modelKey: target.modelKey,
        quality: target.quality,
        model,
      }));
    });
    if (!expandedTargets.length) throw new Error('Select at least one image edit');

    const sourceFile = this.database.resolveAssetFile(batch.sourceAssetId);
    if (!sourceFile) throw new Error('Image edit source is unavailable');
    const allTargetsSupportNativeMask = expandedTargets.every(({ model }) =>
      model.descriptor.capabilities.includes('MASK_EDIT'),
    );
    const mode =
      batch.mode === 'AUTO'
        ? sourceFile.mimeType === 'image/png' && allTargetsSupportNativeMask
          ? 'MASK'
          : 'SEMANTIC'
        : batch.mode;
    if (mode === 'MASK' && !allTargetsSupportNativeMask) {
      throw new Error('Every selected model must support mask editing');
    }
    if (mode === 'MASK' && sourceFile.mimeType !== 'image/png') {
      throw new Error('Native mask editing currently requires a PNG source image');
    }

    const firstTarget = expandedTargets[0];
    const plan = createImageEditGenerationPlan(
      this.database,
      {
        seriesId: batch.seriesId,
        sourceAssetId: batch.sourceAssetId,
        annotationIds: batch.annotationIds,
        modelKey: firstTarget.modelKey,
        mode,
        locale: batch.locale,
        quality: firstTarget.quality,
      },
      mode,
      sourceFile.objectHash,
    );
    const promptInput = plan.promptInput ?? this.capturePromptInput(plan.input);
    const batchId = expandedTargets.length > 1 ? ulid() : null;
    const batchModelKeys = [...new Set(batch.targets.map((target) => target.modelKey))];
    const preparedRuns: PendingGenerationLaunch[] = [];
    let seriesId = batch.seriesId;
    let versionId = '';
    try {
      for (const [index, target] of expandedTargets.entries()) {
        const resolvedInput = this.resolveInput(
          {
            ...plan.input,
            seriesId,
            modelKey: target.modelKey,
            quality: target.quality,
          },
          promptInput,
        );
        const prepared = this.database.prepareGeneration(resolvedInput, promptInput, {
          // An edit spec is immutable per prompt version. Start every edit batch
          // on a fresh version, then share it across the batch's model runs.
          forceNewVersion: index === 0,
        });
        seriesId = prepared.seriesId;
        versionId = prepared.versionId;
        const launch: PendingGenerationLaunch = {
          runId: prepared.runId,
          seriesId: prepared.seriesId,
          versionId: prepared.versionId,
          input: {
            ...resolvedInput,
            seriesId: prepared.seriesId,
            referenceAssetIds: prepared.effectiveReferenceAssetIds,
          },
          promptInput,
          batchId,
          batchPosition: batchId ? index + 1 : null,
          batchTotal: batchId ? expandedTargets.length : null,
          batchModelKeys: batchId ? batchModelKeys : [],
        };
        preparedRuns.push(launch);
        this.database.persistGenerationEditSpec(prepared.runId, batch.sourceAssetId, plan.mode, plan.annotations);
        launch.input = this.withFrozenImageEditPrompt(prepared.runId, launch.input);
      }
    } catch (error) {
      for (const prepared of preparedRuns) {
        this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'IMAGE_EDIT_BATCH_SUBMISSION_ABORTED');
      }
      throw error;
    }
    for (const prepared of preparedRuns) this.launch(prepared);
    return { batchId, runIds: preparedRuns.map(({ runId }) => runId), seriesId, versionId };
  }

  startImageReframe(input: ImageReframeStartInput) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    const model = this.routesRegistry.get(input.modelKey);
    if (model.descriptor.state !== 'READY') {
      throw new Error(`Generation model is unavailable: ${model.descriptor.name}`);
    }
    if (!model.descriptor.capabilities.includes('IMAGE_EDIT')) {
      throw new Error(`${model.descriptor.name} does not support generative reframing`);
    }
    return this.startSingle(createImageReframeGenerationInput(this.database, input));
  }

  private startSingle(
    input: GenerationInput,
    beforeLaunch?: (runId: string) => void,
    prepareExecutionInput?: (runId: string, input: GenerationInput) => GenerationInput,
  ) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    this.assertModel(input.modelKey);
    const promptInput = this.capturePromptInput(input);
    const resolvedInput = this.resolveInput(input, promptInput);
    const prepared = this.database.prepareGeneration(resolvedInput, promptInput);
    try {
      beforeLaunch?.(prepared.runId);
    } catch (error) {
      this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'IMAGE_EDIT_SPEC_FAILED');
      throw error;
    }
    const preparedInput = {
      ...resolvedInput,
      seriesId: prepared.seriesId,
      referenceAssetIds: prepared.effectiveReferenceAssetIds,
    };
    let executionInput: GenerationInput;
    try {
      executionInput =
        prepareExecutionInput?.(prepared.runId, preparedInput) ??
        this.withFrozenImageEditPrompt(prepared.runId, preparedInput);
    } catch (error) {
      this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'GENERATION_INPUT_PREPARATION_FAILED');
      throw error;
    }
    this.launch({
      runId: prepared.runId,
      seriesId: prepared.seriesId,
      versionId: prepared.versionId,
      input: executionInput,
      promptInput,
    });
    return { runId: prepared.runId, seriesId: prepared.seriesId, versionId: prepared.versionId };
  }

  startCodexImageRefinement(input: CodexImageRefinementInput) {
    return this.startImageEdit({
      ...input,
      modelKey: CODEX_APP_SERVER_IMAGE_MODEL_KEY,
      mode: 'SEMANTIC',
    });
  }

  startBatch(batch: GenerationBatchInput) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    if (!batch.targets.length) throw new Error('Select at least one model');
    const expandedTargets = batch.targets.flatMap((target) => {
      this.assertModel(target.modelKey);
      return Array.from({ length: target.count }, () => ({ modelKey: target.modelKey, quality: target.quality }));
    });
    if (!expandedTargets.length) throw new Error('Select at least one generation');
    const batchId = expandedTargets.length > 1 ? ulid() : null;
    const batchModelKeys = [...new Set(batch.targets.map((target) => target.modelKey))];

    const promptInput = this.capturePromptInput(batch.input);
    const resolvedTargets = expandedTargets.map((target) =>
      this.resolveInput(
        {
          ...batch.input,
          modelKey: target.modelKey,
          quality: target.quality,
        },
        promptInput,
      ),
    );
    const preparedRuns: PendingGenerationLaunch[] = [];
    let seriesId = batch.input.seriesId;
    let versionId = '';
    try {
      for (const [index, resolvedTarget] of resolvedTargets.entries()) {
        const targetInput = {
          ...resolvedTarget,
          seriesId,
          creationDraftId: index === 0 ? batch.input.creationDraftId : null,
          baseVersionId: index === 0 ? resolvedTarget.baseVersionId : versionId,
        };
        const prepared = this.database.prepareGeneration(targetInput, promptInput);
        seriesId = prepared.seriesId;
        versionId = prepared.versionId;
        const launch: PendingGenerationLaunch = {
          runId: prepared.runId,
          seriesId: prepared.seriesId,
          versionId: prepared.versionId,
          input: {
            ...targetInput,
            seriesId,
            referenceAssetIds: prepared.effectiveReferenceAssetIds,
          },
          promptInput,
          batchId,
          batchPosition: batchId ? index + 1 : null,
          batchTotal: batchId ? resolvedTargets.length : null,
          batchModelKeys: batchId ? batchModelKeys : [],
        };
        preparedRuns.push(launch);
        launch.input = this.withFrozenImageEditPrompt(prepared.runId, launch.input);
      }
    } catch (error) {
      for (const prepared of preparedRuns) {
        this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'BATCH_SUBMISSION_ABORTED');
      }
      throw error;
    }
    for (const prepared of preparedRuns) this.launch(prepared);
    return { batchId, runIds: preparedRuns.map(({ runId }) => runId), seriesId: seriesId!, versionId };
  }

  startStyleExploration(exploration: StyleExplorationStartInput) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    if (!exploration.slots.length || exploration.slots.length > 4) {
      throw new Error('Select between one and four creative directions');
    }
    if (!exploration.targets.length) throw new Error('Select at least one model');
    this.database.validateStyleExplorationStart(exploration);
    const expandedTargets = exploration.targets.flatMap((target) => {
      this.assertModel(target.modelKey);
      return Array.from({ length: target.count }, () => ({
        modelKey: target.modelKey,
        quality: target.quality,
      }));
    });
    if (!expandedTargets.length) throw new Error('Select at least one generation');

    const preparedRuns: Array<Pick<PendingGeneration, 'runId' | 'seriesId' | 'versionId' | 'input' | 'promptInput'>> =
      [];
    const preparedSlots: Array<{
      label: string;
      rationale: string;
      variableAxis: string;
      risk: string;
      userInstruction: string;
      seriesId: string;
      versionId: string;
      runIds: string[];
    }> = [];
    let batchPersisted = false;
    try {
      for (const slot of exploration.slots) {
        const promptInput = this.capturePromptInput(slot.input);
        let seriesId: string | null = null;
        let versionId = '';
        const slotRunIds: string[] = [];
        const preparedSlot = {
          label: slot.label,
          rationale: slot.rationale,
          variableAxis: slot.variableAxis,
          risk: slot.risk,
          userInstruction: slot.userInstruction,
          seriesId: '',
          versionId: '',
          runIds: slotRunIds,
        };
        preparedSlots.push(preparedSlot);
        for (const target of expandedTargets) {
          const resolvedInput = this.resolveInput(
            {
              ...slot.input,
              seriesId,
              creationDraftId: null,
              modelKey: target.modelKey,
              quality: target.quality,
            },
            promptInput,
          );
          const prepared = this.database.prepareGeneration(resolvedInput, promptInput);
          seriesId = prepared.seriesId;
          versionId = prepared.versionId;
          preparedSlot.seriesId = prepared.seriesId;
          preparedSlot.versionId = prepared.versionId;
          slotRunIds.push(prepared.runId);
          preparedRuns.push({
            runId: prepared.runId,
            seriesId: prepared.seriesId,
            versionId: prepared.versionId,
            input: {
              ...resolvedInput,
              seriesId: prepared.seriesId,
              referenceAssetIds: prepared.effectiveReferenceAssetIds,
            },
            promptInput,
          });
        }
        preparedSlot.seriesId = seriesId!;
        preparedSlot.versionId = versionId;
      }
      const batch = this.database.createStyleExplorationBatch({
        scope: exploration.scope,
        sourceAssistantRunId: exploration.sourceAssistantRunId,
        commonConstraints: exploration.commonConstraints,
        slots: preparedSlots,
        targets: exploration.targets,
        delegation: exploration.delegation,
      });
      batchPersisted = true;
      for (const prepared of preparedRuns) this.launch(prepared);
      return batch;
    } catch (error) {
      for (const prepared of preparedRuns) {
        this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'EXPLORATION_SUBMISSION_ABORTED');
      }
      // If preparation fails after creating one or more runs, keep those
      // cancelled attempts visible as a real interrupted experiment instead
      // of leaving orphan series and hidden spend lineage.
      const recoverableSlots = preparedSlots.filter(
        (slot) => slot.runIds.length > 0 && slot.seriesId && slot.versionId,
      );
      if (!batchPersisted && recoverableSlots.length > 0) {
        try {
          this.database.createStyleExplorationBatch({
            scope: exploration.scope,
            sourceAssistantRunId: exploration.sourceAssistantRunId,
            commonConstraints: exploration.commonConstraints,
            slots: recoverableSlots,
            targets: exploration.targets,
            delegation: exploration.delegation,
          });
        } catch {
          // Preserve the original submission error. The cancelled runs remain
          // globally visible even if the recovery projection cannot persist.
        }
      }
      throw error;
    }
  }

  cancelStyleExploration(batchId: string) {
    const batch = this.database.getStyleExplorationBatch(batchId);
    if (!batch) throw new Error('Style exploration not found');
    for (const runId of this.database.styleExplorationRunIds(batchId)) this.cancel(runId);
  }

  retryStyleExplorationSlot(slotId: string) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    const slot = this.database.getStyleExplorationSlot(slotId);
    if (!slot) throw new Error('Style exploration direction not found');
    const sourceRunIds = this.database.retryableStyleExplorationRunIds(slotId);
    if (!sourceRunIds.length) throw new Error('This direction has no retryable generations');
    const preparedRuns: Array<Pick<PendingGeneration, 'runId' | 'seriesId' | 'versionId' | 'input' | 'promptInput'>> =
      [];
    try {
      for (const sourceRunId of sourceRunIds) {
        const prepared = this.database.prepareGenerationRetry(sourceRunId);
        const promptInput = this.promptInputForVersion(prepared.versionId);
        const pending = {
          runId: prepared.runId,
          seriesId: prepared.seriesId,
          versionId: prepared.versionId,
          input: {
            ...this.resolveInput(prepared.input, promptInput),
            referenceAssetIds: prepared.effectiveReferenceAssetIds,
          },
          promptInput,
        };
        preparedRuns.push(pending);
        this.database.linkStyleExplorationRetry(slotId, prepared.runId);
      }
      for (const prepared of preparedRuns) this.launch(prepared);
    } catch (error) {
      for (const prepared of preparedRuns) {
        this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'EXPLORATION_RETRY_ABORTED');
      }
      throw error;
    }
  }

  startVersion(input: GenerationVersionInput) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    const model = this.routesRegistry.get(input.modelKey);
    if (model.descriptor.state !== 'READY') {
      throw new Error(`Generation model is unavailable: ${model.descriptor.name}`);
    }
    const prepared = this.database.prepareGenerationFromVersion(input.versionId, input.modelKey);
    const editSpec = this.database.getGenerationEditSpec(prepared.runId);
    const requiresImageEdit = Boolean(prepared.input.sourceAssetId);
    const incompatible =
      requiresImageEdit && !model.descriptor.capabilities.includes('IMAGE_EDIT')
        ? `${model.descriptor.name} does not support image editing`
        : editSpec?.mode === 'MASK' && !model.descriptor.capabilities.includes('MASK_EDIT')
          ? `${model.descriptor.name} does not support the frozen native mask`
          : null;
    if (incompatible) {
      this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'MODEL_CAPABILITY_MISMATCH');
      throw new Error(incompatible);
    }
    const promptInput = this.promptInputForVersion(prepared.versionId);
    this.launch({
      runId: prepared.runId,
      seriesId: prepared.seriesId,
      versionId: prepared.versionId,
      input: this.withFrozenImageEditPrompt(prepared.runId, this.resolveInput(prepared.input, promptInput)),
      promptInput,
    });
    return { runId: prepared.runId, seriesId: prepared.seriesId, versionId: prepared.versionId };
  }

  retry(sourceRunId: string) {
    if (this.disposed) throw new Error('Generation service is unavailable');
    const explorationSlotId = this.database.styleExplorationSlotIdForRun(sourceRunId);
    const prepared = this.database.prepareGenerationRetry(sourceRunId);
    const promptInput = this.promptInputForVersion(prepared.versionId);
    const pending = {
      runId: prepared.runId,
      seriesId: prepared.seriesId,
      versionId: prepared.versionId,
      input: this.withFrozenImageEditPrompt(prepared.runId, {
        ...this.resolveInput(prepared.input, promptInput),
        referenceAssetIds: prepared.effectiveReferenceAssetIds,
      }),
      promptInput,
    };
    if (explorationSlotId) {
      try {
        this.database.linkStyleExplorationRetry(explorationSlotId, prepared.runId);
      } catch (error) {
        this.database.markRun(prepared.runId, 'CANCELLED', undefined, 'EXPLORATION_RETRY_LINK_FAILED');
        throw error;
      }
    }
    this.launch(pending);
    return { runId: prepared.runId, seriesId: prepared.seriesId, versionId: prepared.versionId };
  }

  cancel(runId: string) {
    const task = this.pending.get(runId);
    if (!task || task.cancelled) return;
    task.cancelled = true;
    if (task.status === 'QUEUED') {
      this.database.markRun(runId, 'CANCELLED', undefined, 'USER_CANCELLED');
      this.pending.delete(runId);
      this.emitChanged(runId, true);
      this.drainQueue();
      return;
    }
    this.setPhase(task, 'CANCELLING');
    task.cancelExecution?.();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.pending.values()) {
      const userCancelled = task.cancelled;
      task.cancelled = true;
      task.cancelExecution?.();
      this.database.markRun(
        task.runId,
        userCancelled ? 'CANCELLED' : 'INTERRUPTED',
        undefined,
        userCancelled ? 'USER_CANCELLED' : 'APPLICATION_CLOSED',
      );
    }
    this.pending.clear();
    this.removeAllListeners();
  }

  private launch(input: PendingGenerationLaunch) {
    const submittedAt = new Date().toISOString();
    const task: PendingGeneration = {
      ...input,
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
    this.pending.set(task.runId, task);
    this.persistPhase(task);
    this.emitChanged(task.runId);
    this.drainQueue();
  }

  private drainQueue() {
    if (this.disposed) return;
    while (this.activeCount < Math.max(1, this.maxConcurrent)) {
      const task = [...this.pending.values()]
        .sort((left, right) => left.sequence - right.sequence)
        .find((candidate) => candidate.status === 'QUEUED' && !candidate.cancelled);
      if (!task) return;
      task.status = 'RUNNING';
      task.startedAt = new Date().toISOString();
      this.activeCount += 1;
      this.database.markRun(task.runId, 'RUNNING');
      this.setPhase(task, 'PREPARING');
      void this.execute(task);
    }
  }

  private async execute(task: PendingGeneration) {
    let cleanupExecution: (() => void) | null = null;
    let fileOutputReady = false;
    let outputCommitted = false;
    try {
      const model = this.routesRegistry.get(task.input.modelKey);
      const prepared = await model.prepareExecution(task.runId, task.input);
      cleanupExecution = prepared.cleanup ?? null;
      if (task.cancelled || this.disposed) return;
      this.database.freezeGenerationExecution(
        task.runId,
        task.input,
        task.promptInput,
        model.descriptor,
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
        (signal) => this.onExecutionSignal(task, model.descriptor.providerKey, signal),
      );
      if (task.cancelled || this.disposed) return;
      // From this point a FILE result is a recoverable local artifact. Any
      // subsequent metadata or database failure must preserve its staging
      // directory for startup reconciliation.
      fileOutputReady = result.kind === 'FILE';
      if (result.providerRequestId) {
        this.recordProviderAccepted(
          task.runId,
          model.descriptor.providerKey,
          result.providerRequestId,
          result.continuation,
        );
      } else if (result.continuation && typeof this.database.saveGenerationCheckpoint === 'function') {
        this.database.saveGenerationCheckpoint(task.runId, result.continuation, task.progress ?? undefined);
      }
      if (
        result.providerReturnedDescriptions?.length &&
        typeof this.database.recordProviderReturnedDescriptions === 'function'
      ) {
        this.database.recordProviderReturnedDescriptions(task.runId, result.providerReturnedDescriptions);
      }
      // Reaching the save phase means the provider has returned, not that the
      // local commit is complete. Preserve provider-reported progress instead
      // of fabricating a task-level 100% while SQLite/object-store work remains.
      this.setPhase(task, 'SAVING');
      if (result.kind === 'FILE') {
        this.database.finishGeneration(task.runId, result.outputPath, task.input.sourceAssetId ?? null);
      } else {
        this.database.finishGenerationFromAsset(task.runId, result.sourceAssetId, 'MODEL_REPLAY');
      }
      outputCommitted = true;
    } catch (error) {
      if (!task.cancelled && !this.disposed) {
        const savingFailed = fileOutputReady && !outputCommitted;
        const reportedErrorCode =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
        const errorCode = reportedErrorCode ?? (savingFailed ? 'OUTPUT_COMMIT_FAILED' : 'GENERATION_FAILED');
        const interrupted = savingFailed || errorCode === 'LOCAL_STATE';
        const finalStatus = interrupted ? 'INTERRUPTED' : 'FAILED';
        const errorMessage = error instanceof Error ? error.message : 'Generation failed';
        const errorDetails = persistedGenerationErrorDetails(error);
        if (errorDetails) this.database.markRun(task.runId, finalStatus, errorMessage, errorCode, errorDetails);
        else this.database.markRun(task.runId, finalStatus, errorMessage, errorCode);
      }
    } finally {
      // Process shutdown is an interruption, not a completed cancellation or
      // failure. Keep the provider job directory intact so startup recovery can
      // validate a result that may have reached disk just before the child exits.
      if (cleanupExecution && !this.disposed && (!fileOutputReady || outputCommitted)) {
        try {
          cleanupExecution();
        } catch (error) {
          console.error('[generation-temp-cleanup]', {
            code: error instanceof Error && 'code' in error ? error.code : 'CLEANUP_FAILED',
            runId: task.runId,
          });
        }
      }
      if (this.disposed) return;
      if (task.cancelled) this.database.markRun(task.runId, 'CANCELLED', undefined, 'USER_CANCELLED');
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.pending.delete(task.runId);
      this.emitChanged(task.runId, true);
      this.drainQueue();
    }
  }

  private onExecutionSignal(task: PendingGeneration, providerKey: string, signal: GenerationExecutionSignal) {
    if (task.cancelled || this.disposed) return;
    if (signal.type === 'REQUEST_ACCEPTED') {
      if (signal.providerRequestId) this.recordProviderAccepted(task.runId, providerKey, signal.providerRequestId);
      // Persist the remote identity before advertising a waiting state. If the
      // next local write fails, restart reconciliation still has the provider ID.
      this.setPhase(task, 'WAITING_PROVIDER');
      return;
    }
    if (signal.type !== 'PROGRESS') return;
    const phase = signal.stage === 'FINALIZING' ? 'FINALIZING' : signal.stage;
    this.setPhase(task, phase, signal.progress ?? null, signal.message);
  }

  private recordProviderAccepted(runId: string, providerKey: string, providerRequestId: string, checkpoint?: unknown) {
    if (typeof this.database.recordGenerationProviderAccepted !== 'function') return;
    this.database.recordGenerationProviderAccepted(runId, {
      providerKey,
      providerRequestId,
      ...(checkpoint === undefined ? {} : { checkpoint }),
    });
  }

  private setPhase(
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

  private persistPhase(task: PendingGeneration, message?: string) {
    if (typeof this.database.markGenerationPhase !== 'function') return;
    this.database.markGenerationPhase(task.runId, task.phase, task.progress ?? undefined, message);
  }

  private emitChanged(runId: string, terminal = false) {
    const event: GenerationChangedEvent = { runId, tasks: this.tasks, terminal };
    this.emit('changed', event);
  }

  private assertModel(modelKey: string) {
    const model = this.routesRegistry.get(modelKey);
    if (model.descriptor.state !== 'READY') {
      throw new Error(`Generation model is unavailable: ${model.descriptor.name}`);
    }
  }

  private capturePromptInput(
    input: Pick<
      GenerationInput,
      'manualPrompt' | 'promptNodes' | 'termPromptLocale' | 'termIds' | 'wordPaletteReferences' | 'referenceAssetIds'
    >,
  ): PromptCommonInputDto {
    return this.database.capturePromptCommonInput(input);
  }

  private promptInputForVersion(versionId: string) {
    return this.database.getPromptCommonInput(versionId);
  }

  private resolveInput(input: GenerationInput, promptInput: PromptCommonInputDto) {
    return this.database.resolveGenerationInput(input, promptInput);
  }

  private withFrozenImageEditPrompt(runId: string, input: GenerationInput) {
    if (typeof this.database.getGenerationEditSpec !== 'function') return input;
    const editSpec = this.database.getGenerationEditSpec(runId);
    if (!editSpec) return input;
    if (input.sourceAssetId && input.sourceAssetId !== editSpec.sourceAssetId) {
      throw new Error('Image edit source does not match the frozen execution spec');
    }
    if (!input.sourceAssetId) {
      const model = this.routesRegistry.get(input.modelKey);
      if (!model.descriptor.capabilities.includes('IMAGE_EDIT')) {
        throw new Error(`${model.descriptor.name} does not support image editing`);
      }
      if (editSpec.mode === 'MASK' && !model.descriptor.capabilities.includes('MASK_EDIT')) {
        throw new Error(`${model.descriptor.name} does not support the frozen native mask`);
      }
    }
    return {
      ...input,
      sourceAssetId: editSpec.sourceAssetId,
      referenceAssetIds: [
        editSpec.sourceAssetId,
        ...input.referenceAssetIds.filter((assetId) => assetId !== editSpec.sourceAssetId),
      ],
      prompt: buildImageEditPrompt(input.prompt, editSpec.annotations, editSpec.mode),
    };
  }
}

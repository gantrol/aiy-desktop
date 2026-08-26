import { ulid } from 'ulid';
import type {
  CodexImageRefinementInput,
  GenerationBatchInput,
  GenerationInput,
  GenerationVersionInput,
  ImageEditBatchStartInput,
  ImageEditStartInput,
  ImageReframeStartInput,
  StyleExplorationStartInput,
} from '@/shared/contracts';
import { GenerationCoordinatorRuntime } from '@/main/generation/coordinator-runtime';
import type { GenerationService } from '@/main/generation/service';
import type { PendingGenerationLaunch } from '@/main/generation/task-state';
import { createImageEditGenerationPlan, createImageReframeGenerationInput } from '@/main/image-edit/image-edit-planner';
import { CODEX_APP_SERVER_IMAGE_MODEL_KEY } from '@/shared/extension-ids';

export class GenerationCoordinator extends GenerationCoordinatorRuntime implements GenerationService {
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
    const anyTargetSupportsNativeMask = expandedTargets.some(({ model }) =>
      model.descriptor.capabilities.includes('MASK_EDIT'),
    );
    const mode =
      batch.mode === 'AUTO'
        ? sourceFile.mimeType === 'image/png' && anyTargetSupportsNativeMask
          ? 'MASK'
          : 'SEMANTIC'
        : batch.mode;
    if (mode === 'MASK' && !anyTargetSupportsNativeMask) {
      throw new Error('Native mask mode requires at least one model that supports mask editing');
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
    const resolvedTargets = expandedTargets.map((target) => ({
      target,
      resolvedInput: this.resolveInput(
        {
          ...plan.input,
          seriesId: batch.seriesId,
          modelKey: target.modelKey,
          quality: target.quality,
        },
        promptInput,
      ),
    }));
    for (const { resolvedInput } of resolvedTargets) this.assertGenerationInput(resolvedInput);
    const batchId = expandedTargets.length > 1 ? ulid() : null;
    const batchModelKeys = [...new Set(batch.targets.map((target) => target.modelKey))];
    const preparedRuns: PendingGenerationLaunch[] = [];
    let seriesId = batch.seriesId;
    let versionId = '';
    try {
      for (const [index, { resolvedInput }] of resolvedTargets.entries()) {
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
    this.launchBatch(preparedRuns);
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
    this.assertGenerationInput(resolvedInput);
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
    for (const resolvedTarget of resolvedTargets) this.assertGenerationInput(resolvedTarget);
    const preparedRuns: PendingGenerationLaunch[] = [];
    let seriesId = batch.input.seriesId;
    let versionId = '';
    try {
      for (const [index, resolvedTarget] of resolvedTargets.entries()) {
        const targetInput = {
          ...resolvedTarget,
          seriesId,
          creationDraftId: index === 0 ? batch.input.creationDraftId : null,
          inspirationStashId: index === 0 ? batch.input.inspirationStashId : null,
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
    this.launchBatch(preparedRuns);
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

    const slotPlans = exploration.slots.map((slot) => {
      const promptInput = this.capturePromptInput(slot.input);
      const resolvedInputs = expandedTargets.map((target) =>
        this.resolveInput(
          {
            ...slot.input,
            seriesId: null,
            creationDraftId: null,
            modelKey: target.modelKey,
            quality: target.quality,
          },
          promptInput,
        ),
      );
      for (const resolvedInput of resolvedInputs) this.assertGenerationInput(resolvedInput);
      return { slot, promptInput, resolvedInputs };
    });

    const preparedRuns: PendingGenerationLaunch[] = [];
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
      for (const { slot, promptInput, resolvedInputs } of slotPlans) {
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
        for (const resolvedInput of resolvedInputs) {
          const preparedInput = { ...resolvedInput, seriesId };
          const prepared = this.database.prepareGeneration(preparedInput, promptInput);
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
              ...preparedInput,
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
      this.launchBatch(preparedRuns);
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
    const preparedRuns: PendingGenerationLaunch[] = [];
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
      this.launchBatch(preparedRuns);
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
    this.assertGenerationInput(input);
    const prepared = this.database.prepareGenerationFromVersion(input.versionId, input.modelKey, {
      canvasPresetKey: input.canvasPresetKey,
      width: input.width,
      height: input.height,
      quality: input.quality,
    });
    const requiresImageEdit = Boolean(prepared.input.sourceAssetId);
    const incompatible =
      requiresImageEdit && !model.descriptor.capabilities.includes('IMAGE_EDIT')
        ? `${model.descriptor.name} does not support image editing`
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
    this.admissionScheduler.clear();
    this.removeAllListeners();
  }
}

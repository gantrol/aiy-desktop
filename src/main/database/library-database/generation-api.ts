import type { GenerationProviderAcceptance } from '@/main/database/generation/generation-job-repository';
import type { PersistedImageEditMode } from '@/main/database/generation/image-edit-repository';
import type { ImageCropStoredCommitInput } from '@/main/database/generation/image-transform-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { GenerationExecutionRequestSnapshot } from '@/main/generation-models';
import type {
  AnnotationDto,
  AnnotationInput,
  AnnotationStatusInput,
  AnnotationUpdateInput,
  DeletePromptSeriesInput,
  GenerationErrorDetailsDto,
  GenerationInput,
  GenerationVersionInput,
  ImageGenerationRouteDto,
  PromptCommonInputDto,
  ProviderReturnedDescriptionInput,
  RenamePromptSeriesInput,
} from '@/shared/contracts';
import type { GenerationProcessEventPageInput } from '@/shared/contracts/generation-process';

export function createGenerationApi(
  repositories: Pick<
    LibraryDatabaseRepositories,
    | 'executionSnapshots'
    | 'generationJobs'
    | 'generationProcesses'
    | 'imageEdits'
    | 'imageTransforms'
    | 'providerDescriptions'
    | 'storage'
    | 'workbench'
  >,
) {
  return {
    renamePromptSeries(input: RenamePromptSeriesInput) {
      return repositories.workbench.renameSeries(input);
    },

    deletePromptSeries(input: DeletePromptSeriesInput) {
      return repositories.workbench.deleteSeries(input);
    },

    getAssetPath(assetId: string) {
      return repositories.workbench.getAssetPath(assetId);
    },

    resolveImageCropSource(seriesId: string, assetId: string) {
      return repositories.imageTransforms.resolveCropSource(seriesId, assetId);
    },

    persistGenerationEditSpec(
      runId: string,
      sourceAssetId: string,
      mode: PersistedImageEditMode,
      annotations: readonly AnnotationDto[],
    ) {
      return repositories.imageEdits.persistForRun(runId, sourceAssetId, mode, annotations);
    },

    getGenerationEditSpec(runId: string) {
      return repositories.imageEdits.forRun(runId);
    },

    getGenerationEditGuide(runId: string) {
      return repositories.imageEdits.annotationGuideForRun(runId);
    },

    reuseAnnotationHistory(promptVersionId: string) {
      return repositories.imageEdits.reuseAnnotationsForVersion(promptVersionId);
    },

    storeImageTransformBuffer(bytes: Uint8Array) {
      return repositories.storage.storeBufferAsync(bytes, '.png');
    },

    commitStoredImageCrop(input: ImageCropStoredCommitInput) {
      return repositories.imageTransforms.createStoredCrop(input);
    },

    listGenerationReplaySources() {
      return repositories.workbench.listGenerationReplaySources();
    },

    hasGenerationReplaySources() {
      return repositories.workbench.hasGenerationReplaySources();
    },

    importReference(sourcePath: string) {
      return repositories.workbench.importReference(sourcePath);
    },

    importReferenceAsync(sourcePath: string) {
      return repositories.workbench.importReferenceAsync(sourcePath);
    },

    capturePromptCommonInput(
      input: Pick<
        GenerationInput,
        'manualPrompt' | 'promptNodes' | 'termPromptLocale' | 'termIds' | 'wordPaletteReferences' | 'referenceAssetIds'
      >,
    ) {
      return repositories.executionSnapshots.captureCommonInput(input);
    },

    getPromptCommonInput(versionId: string) {
      return repositories.executionSnapshots.getCommonInput(versionId);
    },

    resolveGenerationInput(input: GenerationInput, promptInput: PromptCommonInputDto, promptProfileId?: string) {
      return repositories.executionSnapshots.resolveGenerationInput(input, promptInput, promptProfileId);
    },

    freezeGenerationExecution(
      runId: string,
      generationInput: GenerationInput,
      promptInput: PromptCommonInputDto,
      route: ImageGenerationRouteDto,
      request: GenerationExecutionRequestSnapshot,
    ) {
      return repositories.executionSnapshots.freezeGenerationExecution({
        runId,
        generationInput,
        promptInput,
        route,
        request,
      });
    },

    getGenerationExecutionRequest(runId: string) {
      return repositories.executionSnapshots.getRunSnapshots(runId).executionInputSnapshot?.actualRequest ?? null;
    },

    recordProviderReturnedDescriptions(runId: string, inputs: readonly ProviderReturnedDescriptionInput[]) {
      return repositories.providerDescriptions.record(runId, inputs);
    },

    prepareGeneration(
      input: GenerationInput,
      promptInput?: PromptCommonInputDto,
      options?: { forceNewVersion?: boolean },
    ) {
      return repositories.workbench.prepareGeneration(
        input,
        promptInput ?? repositories.executionSnapshots.captureCommonInput(input),
        options,
      );
    },

    prepareGenerationRetry(runId: string) {
      return repositories.workbench.prepareGenerationRetry(runId);
    },

    prepareGenerationFromVersion(
      versionId: string,
      modelKey: string,
      settings?: Omit<GenerationVersionInput, 'versionId' | 'modelKey'>,
    ) {
      return repositories.workbench.prepareGenerationFromVersion(versionId, modelKey, settings);
    },

    markRun(
      runId: string,
      status: string,
      errorMessage?: string,
      errorCode?: string,
      errorDetails?: GenerationErrorDetailsDto,
    ) {
      return repositories.workbench.markRun(runId, status, errorMessage, errorCode, errorDetails);
    },

    setGenerationOutputFailed(runId: string, failed: boolean) {
      return repositories.workbench.setGenerationOutputFailed(runId, failed);
    },

    markGenerationPhase(runId: string, phase: string, progress?: number | null, statusMessage?: string | null) {
      return repositories.generationJobs.markPhase(runId, phase, progress, statusMessage);
    },

    recordGenerationProviderAccepted(runId: string, input: GenerationProviderAcceptance) {
      return repositories.generationJobs.recordProviderAccepted(runId, input);
    },

    saveGenerationCheckpoint(runId: string, checkpoint: unknown, progress?: number | null) {
      return repositories.generationJobs.saveCheckpoint(runId, checkpoint, progress);
    },

    heartbeatGeneration(runId: string, progress?: number | null) {
      return repositories.generationJobs.heartbeat(runId, progress);
    },

    getGenerationJob(runId: string) {
      return repositories.generationJobs.getForRun(runId);
    },

    getGenerationProcessSummary(runId: string) {
      return repositories.generationProcesses.summary(runId);
    },

    listGenerationProcessEvents(input: GenerationProcessEventPageInput) {
      return repositories.generationProcesses.events(input);
    },

    listRecoverableGenerationRuns() {
      return repositories.generationJobs.listRecoverable();
    },

    listGenerationRunIdsForTempCleanup() {
      return repositories.workbench.listGenerationRunIdsForTempCleanup();
    },

    getGenerationRunModelKey(runId: string) {
      return repositories.workbench.getGenerationRunModelKey(runId);
    },

    finishGeneration(runId: string, outputPath: string, sourceAssetId: string | null = null) {
      return repositories.workbench.finishGeneration(runId, outputPath, sourceAssetId);
    },

    finishGenerationFromAsset(runId: string, sourceAssetId: string, relationType: 'MODEL_REPLAY') {
      return repositories.workbench.finishGenerationFromAsset(runId, sourceAssetId, relationType);
    },

    listAnnotations(assetId: string) {
      return repositories.workbench.listAnnotations(assetId);
    },

    addAnnotation(input: AnnotationInput) {
      return repositories.workbench.addAnnotation(input);
    },

    updateAnnotation(input: AnnotationUpdateInput) {
      return repositories.workbench.updateAnnotation(input);
    },

    setAnnotationStatus(input: AnnotationStatusInput) {
      return repositories.workbench.setAnnotationStatus(input);
    },

    getReferencePaths(assetIds: string[]) {
      return repositories.workbench.getReferencePaths(assetIds);
    },

    getLibraryName() {
      return repositories.workbench.getLibraryName();
    },
  };
}

export type GenerationApi = ReturnType<typeof createGenerationApi>;

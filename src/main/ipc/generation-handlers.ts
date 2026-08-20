import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation/service';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { ImageTransformService } from '@/main/media/image-transform-service';
import {
  annotationHistoryReuseSchema,
  annotationSchema,
  annotationStatusSchema,
  annotationUpdateSchema,
  codexImageRefinementSchema,
  creatorAgentAssistSchema,
  dictionaryMaintenanceCreateSchema,
  dictionaryMaintenanceListSchema,
  generationBatchSchema,
  generationOutputSetFailedSchema,
  generationSchema,
  generationVersionSchema,
  historicalTermRecommendationCreateSchema,
  historicalTermRecommendationListSchema,
  id,
  imageCropSchema,
  imageEditBatchStartSchema,
  imageEditStartSchema,
  imageReframeStartSchema,
  knowledgeDistillationAcceptSchema,
  knowledgeDistillationCreateSchema,
  promptVersionCreateSchema,
  styleExplorationStartSchema,
} from '@/main/ipc/schemas';
import {
  generationProcessEventPageInputSchema,
  generationProcessEventPageSchema,
  generationProcessSummarySchema,
} from '@/shared/contracts/generation-process';

export function registerGenerationIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  generation: GenerationService,
  imageTransforms: ImageTransformService,
  runAssistantRequest: (request: z.infer<typeof creatorAgentAssistSchema>) => unknown,
) {
  ipcMain.handle('generation:start', (_event, raw) => generation.start(generationSchema.parse(raw)));
  ipcMain.handle('generation:start-batch', (_event, raw) => generation.startBatch(generationBatchSchema.parse(raw)));
  ipcMain.handle('image-edit:start', (_event, raw) => generation.startImageEdit(imageEditStartSchema.parse(raw)));
  ipcMain.handle('image-edit:start-batch', (_event, raw) =>
    generation.startImageEditBatch(imageEditBatchStartSchema.parse(raw)),
  );
  ipcMain.handle('image-transform:crop', (_event, raw) => {
    const input = imageCropSchema.parse(raw);
    return generation.cropImage ? generation.cropImage(input) : imageTransforms.crop(input);
  });
  ipcMain.handle('image-transform:reframe-start', (_event, raw) =>
    generation.startImageReframe(imageReframeStartSchema.parse(raw)),
  );
  ipcMain.handle('codex:image-refinement-start', (_event, raw) =>
    generation.startCodexImageRefinement(codexImageRefinementSchema.parse(raw)),
  );
  ipcMain.handle('style-exploration:start', (_event, raw) =>
    generation.startStyleExploration(styleExplorationStartSchema.parse(raw)),
  );
  ipcMain.handle('style-exploration:propose-adjacent', async (_event, rawSlotId) => {
    const slot = database.getStyleExplorationSlot(id.parse(rawSlotId));
    if (!slot) throw new Error('Style exploration direction not found');
    if (slot.completedCount < 1) throw new Error('An adjacent experiment requires a completed result');
    const batch = database.getStyleExplorationBatch(slot.batchId);
    if (!batch) throw new Error('Style exploration batch not found');
    const sourceRun = database.getAssistantRun(batch.sourceAssistantRunId);
    if (!sourceRun?.proposal || sourceRun.status !== 'SUCCEEDED') {
      throw new Error('The source direction proposal is unavailable');
    }
    if (sourceRun.proposal.status === 'CLOSED') {
      throw new Error('The source direction proposal is closed');
    }

    const contextKey = `adjacent:v1:${createHash('sha256')
      .update(
        JSON.stringify({
          sourceAssistantRunId: sourceRun.id,
          sourceContextHash: sourceRun.contextHash,
          sourceProposalId: sourceRun.proposal.id,
          batchId: batch.id,
          slotId: slot.id,
          versionId: slot.versionId,
          commonConstraints: batch.commonConstraints,
          label: slot.label,
          userInstruction: slot.userInstruction,
          variableAxis: slot.variableAxis,
          risk: slot.risk,
        }),
      )
      .digest('hex')}`;
    const request = creatorAgentAssistSchema.parse({
      ...sourceRun.input,
      mode: 'directions',
      directionStrategy: 'ADJACENT',
      prompt: slot.userInstruction,
      message:
        sourceRun.input.locale === 'zh'
          ? `用户明确选择了已完成的“${slot.label}”方向。仅依据冻结的 Prompt 与这次人工选择，围绕当前变化轴“${slot.variableAxis}”提出 3 个相邻实验。共同保持项不变；每个方向只能移动一个邻近变量值，不得引入无关变化轴。当前已知风险：${slot.risk || '无'}。没有视觉模型，不得声称分析过生成图片。`
          : `The user explicitly selected the completed “${slot.label}” direction. Using only its frozen prompt and this explicit selection, propose 3 adjacent experiments around the current axis “${slot.variableAxis}”. Keep the shared constraints fixed; each direction may move only one nearby variable value and must not introduce an unrelated axis. Known risk: ${slot.risk || 'none'}. No vision model is available, so do not claim to have analyzed the generated images.`,
      parentProposalId: sourceRun.proposal.id,
      sourceExperimentSlotId: slot.id,
      contextKey,
    });
    return runAssistantRequest(request);
  });
  ipcMain.handle('style-exploration:cancel', (_event, rawId) => generation.cancelStyleExploration(id.parse(rawId)));
  ipcMain.handle('style-exploration:retry-slot', (_event, rawId) =>
    generation.retryStyleExplorationSlot(id.parse(rawId)),
  );
  ipcMain.handle('knowledge-distillation:list', (_event, rawAssetId) =>
    database.listKnowledgeDistillationProposals(id.parse(rawAssetId)),
  );
  ipcMain.handle('knowledge-distillation:create', (_event, raw) =>
    database.createKnowledgeDistillationProposal(knowledgeDistillationCreateSchema.parse(raw)),
  );
  ipcMain.handle('knowledge-distillation:accept', (_event, raw) =>
    database.acceptKnowledgeDistillationProposal(knowledgeDistillationAcceptSchema.parse(raw)),
  );
  ipcMain.handle('historical-term-recommendations:list', (_event, raw) =>
    database.listHistoricalTermRecommendationRuns(historicalTermRecommendationListSchema.parse(raw)),
  );
  ipcMain.handle('historical-term-recommendations:create', (_event, raw) =>
    database.createHistoricalTermRecommendationRun(historicalTermRecommendationCreateSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-maintenance:list', (_event, raw) =>
    database.listDictionaryMaintenanceReports(dictionaryMaintenanceListSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-maintenance:create', (_event, raw) =>
    database.createDictionaryMaintenanceReport(dictionaryMaintenanceCreateSchema.parse(raw)),
  );
  ipcMain.handle('generation:start-version', (_event, raw) =>
    generation.startVersion(generationVersionSchema.parse(raw)),
  );
  ipcMain.handle('prompt-version:create', (_event, raw) =>
    database.createPromptVersion(promptVersionCreateSchema.parse(raw)),
  );
  ipcMain.handle('generation:retry', (_event, rawId) => generation.retry(id.parse(rawId)));
  ipcMain.handle('generation:cancel', (_event, rawId) => generation.cancel(id.parse(rawId)));
  ipcMain.handle('generation:process-summary', (_event, rawId) =>
    generationProcessSummarySchema.nullable().parse(database.getGenerationProcessSummary(id.parse(rawId))),
  );
  ipcMain.handle('generation:process-events', (_event, raw) => {
    const input = generationProcessEventPageInputSchema.parse(raw);
    return generationProcessEventPageSchema.nullable().parse(database.listGenerationProcessEvents(input));
  });
  ipcMain.handle('generation:execution-request', (_event, rawId) =>
    database.getGenerationExecutionRequest(id.parse(rawId)),
  );
  ipcMain.handle('generation:output-set-failed', (_event, raw) => {
    const input = generationOutputSetFailedSchema.parse(raw);
    return database.setGenerationOutputFailed(input.runId, input.failed);
  });
  ipcMain.handle('annotations:list', (_event, rawId) => database.listAnnotations(id.parse(rawId)));
  ipcMain.handle('annotations:add', (_event, raw) => database.addAnnotation(annotationSchema.parse(raw)));
  ipcMain.handle('annotations:update', (_event, raw) => database.updateAnnotation(annotationUpdateSchema.parse(raw)));
  ipcMain.handle('annotations:reuse-history', (_event, raw) =>
    database.reuseAnnotationHistory(annotationHistoryReuseSchema.parse(raw).promptVersionId),
  );
  ipcMain.handle('annotations:set-status', (_event, raw) =>
    database.setAnnotationStatus(annotationStatusSchema.parse(raw)),
  );
}

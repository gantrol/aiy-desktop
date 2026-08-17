import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GenerationInput } from '@/shared/contracts';
import { CodexTextAdapter } from '@/main/assistant/codex-text-adapter';
import {
  type CodexGenerationProgress,
  type CodexImageAppServerRequest,
  type CodexImageExecutionMode,
  type CodexThreadContext,
  type PreparedCodexImageGeneration,
  buildCodexImageOuterRequest,
  createExactTempJob,
  nativeLocalPath,
  regularFileExists,
  reportCleanupFailure,
} from '@/main/assistant/codex-runtime';
import type { CodexAppServerTurnEvent } from '@/main/extensions/codex-app-server/client';
import {
  buildCodexAppServerImageTurnInput,
  codexAppServerImageDeveloperInstructions,
  codexImageOperation,
  codexImageReferenceAssetIds,
} from '@/main/extensions/codex-app-server/image-runtime';
import { validatePngFileAsync } from '@/main/media/png-validation';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';

export {
  CodexTempLifecycleError,
  buildCodexAssistCreatorPayload,
  buildCodexAssistPrompt,
  buildCodexImageOuterRequest,
  normalizeAssistResult,
} from '@/main/assistant/codex-runtime';
export type {
  CodexAdapterLifecycleOptions,
  CodexExecutionObserver,
  CodexGenerationProgress,
  CodexImageAppServerRequest,
  CodexImageExecutionMode,
  CodexImageOuterRequest,
  CodexImageRequest,
  CodexStructuredTextInput,
  CodexStructuredTextResult,
  CodexThreadContext,
  PreparedCodexImageGeneration,
} from '@/main/assistant/codex-runtime';

export class CodexAdapter extends CodexTextAdapter {
  async prepareGeneration(
    runId: string,
    input: GenerationInput,
    executionMode?: CodexImageExecutionMode,
  ): Promise<PreparedCodexImageGeneration> {
    if (!this.health.authenticated) await this.refreshHealth();
    if (!this.health.authenticated) throw new Error(this.health.message);
    const resolvedMode = executionMode ?? (this.imageBinary || this.transport === 'exec' ? 'cli' : 'app-server');
    if (resolvedMode === 'app-server') return this.prepareAppServerGeneration(runId, input);
    if (this.imageBinary) return this.prepareCliGeneration(runId, input, this.imageBinary);
    return this.prepareCliGeneration(runId, input, this.binary);
  }

  private async prepareCliGeneration(
    runId: string,
    input: GenerationInput,
    imageBinary: string,
  ): Promise<PreparedCodexImageGeneration> {
    this.tempJobRemover(this.libraryRoot, 'generation', runId);
    try {
      const { jobDir } = createExactTempJob(this.libraryRoot, 'generation', runId);
      const referenceDir = path.join(jobDir, 'references');
      await mkdir(referenceDir);
      const { paths: referencePaths, hasLocalizationGuide } = this.imageInputPaths(runId, input);
      const localReferences: string[] = [];
      for (const [index, source] of referencePaths.entries()) {
        const destination = path.join(
          referenceDir,
          `${String(index + 1).padStart(2, '0')}${path.extname(source).toLowerCase()}`,
        );
        await copyFile(source, destination);
        localReferences.push(path.relative(jobDir, destination).replaceAll('\\', '/'));
      }
      const outputPath = path.join(jobDir, 'result.png');
      const request = buildCodexImageOuterRequest(
        imageBinary,
        jobDir,
        outputPath,
        input,
        localReferences,
        hasLocalizationGuide,
      );
      return {
        request,
        execute: async (onStarted, onProgress) => {
          onProgress?.({ stage: 'PREPARING', message: 'Preparing Codex CLI image task' });
          onProgress?.({ stage: 'GENERATING', message: 'Generating image with Codex CLI' });
          await this.processRunner(request.command, request.arguments, request.stdin, request.cwd, 900_000, (child) =>
            onStarted(() => child.kill()),
          );
          onProgress?.({ stage: 'FINALIZING', message: 'Collecting generated image' });
          if (!(await validatePngFileAsync(request.expectedOutputPath)))
            throw new Error('Codex output is not a complete valid PNG file');
          return request.expectedOutputPath;
        },
        cleanup: () => this.tempJobRemover(this.libraryRoot, 'generation', runId),
      };
    } catch (error) {
      try {
        this.tempJobRemover(this.libraryRoot, 'generation', runId);
      } catch (cleanupError) {
        reportCleanupFailure(cleanupError, 'generation');
      }
      throw error;
    }
  }

  private imageInputPaths(runId: string, input: GenerationInput) {
    const assetIds = codexImageReferenceAssetIds(input);
    const assetPaths = this.database.getReferencePaths(assetIds);
    if (assetPaths.length !== assetIds.length) {
      throw new Error('One or more Codex image inputs are unavailable');
    }
    if (!input.sourceAssetId) return { paths: assetPaths, hasLocalizationGuide: false };
    if (!assetPaths.length) throw new Error('Codex image edit source is unavailable');
    const editSpec = this.database.getGenerationEditSpec(runId);
    if (!editSpec) return { paths: assetPaths, hasLocalizationGuide: false };
    if (editSpec.sourceAssetId !== input.sourceAssetId) {
      throw new Error('Codex image edit range guide does not match its source');
    }
    const guide = this.database.getGenerationEditGuide(runId);
    if (!guide) throw new Error('Codex image edit range guide is unavailable');
    return {
      paths: [assetPaths[0], guide.localPath, ...assetPaths.slice(1)],
      hasLocalizationGuide: true,
    };
  }

  private async prepareAppServerGeneration(
    runId: string,
    input: GenerationInput,
  ): Promise<PreparedCodexImageGeneration> {
    this.tempJobRemover(this.libraryRoot, 'generation', runId);
    try {
      const { jobDir } = createExactTempJob(this.libraryRoot, 'generation', runId);
      const referenceDir = path.join(jobDir, 'references');
      await mkdir(referenceDir);
      const { paths: referencePaths, hasLocalizationGuide } = this.imageInputPaths(runId, input);
      const localReferences: string[] = [];
      for (const [index, source] of referencePaths.entries()) {
        const destination = path.join(
          referenceDir,
          `${String(index + 1).padStart(2, '0')}${path.extname(source).toLowerCase()}`,
        );
        await copyFile(source, destination);
        localReferences.push(destination);
      }
      const outputPath = path.join(jobDir, 'result.png');
      const seriesId = input.seriesId ?? `unbound-${runId}`;
      const turnInput = buildCodexAppServerImageTurnInput(input, hasLocalizationGuide);
      const request: CodexImageAppServerRequest = {
        transport: 'CODEX_APP_SERVER',
        operation: codexImageOperation(input),
        cwd: jobDir,
        threadScope: { kind: 'SERIES', id: seriesId },
        turnInput,
        localReferences,
        expectedOutputPath: outputPath,
        qualityControl: 'PROVIDER_MANAGED',
      };
      return {
        request,
        execute: async (onStarted, onProgress) => {
          onProgress?.({ stage: 'PREPARING', message: 'Preparing Codex task' });
          const parentContext: CodexThreadContext = {
            scope: { kind: 'SYSTEM', id: `session:SERIES:${seriesId}` },
            title: input.title.trim() || '方向实验',
          };
          const imageInstructions = codexAppServerImageDeveloperInstructions(input);
          const parentThreadId = await this.serializeThread(parentContext, () =>
            this.getOrCreateThread(parentContext, jobDir, imageInstructions),
          );
          let childThreadId: string;
          try {
            const fork = await this.appServer.forkThread(parentThreadId, {
              cwd: jobDir,
              developerInstructions: imageInstructions,
            });
            childThreadId = fork.thread.id;
          } catch (error) {
            if (!this.isRecoverableForkFailure(error)) throw error;
            childThreadId = (
              await this.appServer.startThread({
                cwd: jobDir,
                developerInstructions: imageInstructions,
              })
            ).thread.id;
          }
          const childName = this.generationThreadName(runId, input, parentContext.title);
          this.database.bindExtensionThread({
            extensionId: CODEX_APP_SERVER_EXTENSION_ID,
            scopeKind: 'SYSTEM',
            scopeId: `generation:${runId}`,
            threadId: childThreadId,
            threadName: childName,
          });
          await this.appServer.setThreadName(childThreadId, childName).catch(() => undefined);
          const turn = await this.appServer.runTurn({
            threadId: childThreadId,
            cwd: jobDir,
            text: turnInput,
            localImages: localReferences,
            timeoutMs: 900_000,
            onStarted: (cancel) => onStarted(cancel),
            onEvent: (event) => this.reportGenerationEvent(event, onProgress),
          });
          onProgress?.({ stage: 'FINALIZING', message: 'Collecting generated image' });
          await this.materializeAppServerImage(turn.image, outputPath);
          if (!(await validatePngFileAsync(outputPath)))
            throw new Error('Codex output is not a complete valid PNG file');
          return outputPath;
        },
        cleanup: () => this.tempJobRemover(this.libraryRoot, 'generation', runId),
      };
    } catch (error) {
      try {
        this.tempJobRemover(this.libraryRoot, 'generation', runId);
      } catch (cleanupError) {
        reportCleanupFailure(cleanupError, 'generation');
      }
      throw error;
    }
  }

  private reportGenerationEvent(
    event: CodexAppServerTurnEvent,
    listener?: (progress: CodexGenerationProgress) => void,
  ) {
    if (!listener) return;
    if (
      event.itemType === 'imageGeneration' ||
      event.itemType === 'mcpToolCall' ||
      event.itemType === 'dynamicToolCall'
    ) {
      listener({ stage: 'GENERATING', message: 'Codex image tool is running' });
    }
  }

  private async materializeAppServerImage(
    image: { savedPath: string | null; result: string } | null,
    outputPath: string,
  ) {
    if (!image) throw new Error('Codex completed without an image generation item');
    const savedPath = image.savedPath ? nativeLocalPath(image.savedPath) : null;
    const resultPath = image.result.length < 4_096 ? nativeLocalPath(image.result) : '';
    const source =
      savedPath && (await regularFileExists(savedPath))
        ? savedPath
        : image.result &&
            image.result.length < 4_096 &&
            path.isAbsolute(resultPath) &&
            (await regularFileExists(resultPath))
          ? resultPath
          : null;
    if (source) {
      if (path.resolve(source) !== path.resolve(outputPath)) await copyFile(source, outputPath);
      return;
    }
    const dataUrl = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image.result);
    if (dataUrl) await writeFile(outputPath, Buffer.from(dataUrl[1], 'base64'));
  }
}

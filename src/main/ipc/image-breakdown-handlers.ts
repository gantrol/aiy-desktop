import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantService } from '@/main/assistant/assistant-service';
import { listImageBreakdownRoutes } from '@/main/assistant-models/image-breakdown-routes';
import type { LibraryDatabase } from '@/main/database';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import type { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { GenerationService } from '@/main/generation/service';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import {
  imageBreakdownCreateInputSchema,
  imageBreakdownCreateResultSchema,
  imageBreakdownImageFormCreateInputSchema,
  imageBreakdownImageFormCreateResultSchema,
  imageBreakdownReplaceSourceInputSchema,
  imageBreakdownResultSchema,
  imageBreakdownRoutesSchema,
  imageBreakdownRunInputSchema,
} from '@/shared/contracts/image-breakdown';
import { ANTIGRAVITY_CLI_EXTENSION_ID } from '@/shared/extension-ids';

function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png' as const;
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg' as const;
  if (extension === '.webp') return 'image/webp' as const;
  throw new Error('Image breakdown requires a PNG, JPEG, or WebP source');
}

async function withModelImagePath<T>(filePath: string, consume: (modelPath: string) => Promise<T>) {
  if (path.extname(filePath).toLowerCase() !== '.gif') return consume(filePath);
  const normalized = await withDecodedImageFileInSandbox(filePath, { operation: 'normalize' }, async (result) => {
    if (result.operation !== 'normalize') throw new Error('GIF decoder returned the wrong operation');
    const bytes = Buffer.from(result.pngBytes.buffer, result.pngBytes.byteOffset, result.pngBytes.byteLength);
    const structure = await validateCanvasPngAsync(bytes);
    if (!structure || structure.width !== result.width || structure.height !== result.height) {
      throw new Error('GIF decoder returned an invalid PNG');
    }
    return Buffer.from(bytes);
  });
  const temporaryPath = path.join(tmpdir(), `aiy-image-breakdown-${randomUUID()}.png`);
  await writeFile(temporaryPath, normalized, { flag: 'wx', mode: 0o600 });
  try {
    return await consume(temporaryPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function errorDetails(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'IMAGE_BREAKDOWN_FAILED';
  const message = error instanceof Error ? error.message : 'Image breakdown failed';
  return { code, message };
}

export function registerImageBreakdownIpc(options: {
  ipcMain: IpcHandlerRegistrar;
  database: LibraryDatabase;
  assistant: AssistantService;
  extensions: ExtensionRegistry;
  externalImageApis: ExternalImageApiConnections;
  deepSeekApi: DeepSeekApiConnection;
  generation: GenerationService;
}) {
  const { ipcMain, database, assistant, extensions, externalImageApis, deepSeekApi, generation } = options;
  const runningIds = new Set<string>();

  async function routes(refreshAntigravity: boolean) {
    let status = generation.antigravityCliStatus;
    if (
      refreshAntigravity &&
      extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID) &&
      status?.state !== 'ready' &&
      generation.refreshAntigravityCli
    ) {
      status = await Promise.resolve(generation.refreshAntigravityCli()).catch(() => generation.antigravityCliStatus);
    }
    return imageBreakdownRoutesSchema.parse(
      listImageBreakdownRoutes(extensions, externalImageApis, deepSeekApi, status),
    );
  }

  ipcMain.handle('image-breakdown:create', (_event, raw) =>
    imageBreakdownCreateResultSchema.parse(database.createImageBreakdown(imageBreakdownCreateInputSchema.parse(raw))),
  );

  ipcMain.handle('image-breakdown:list-routes', () => routes(true));

  ipcMain.handle('image-breakdown:replace-source', (_event, raw) => {
    const input = imageBreakdownReplaceSourceInputSchema.parse(raw);
    return database.replaceImageBreakdownSource(input.id, input.sourceAssetId);
  });

  ipcMain.handle('image-breakdown:run', async (_event, raw) => {
    const input = imageBreakdownRunInputSchema.parse(raw);
    if (runningIds.has(input.id)) throw new Error('Image breakdown is already running');
    const route = (await routes(input.routeKey === 'ANTIGRAVITY_CLI')).find(
      (candidate) => candidate.key === input.routeKey && candidate.modelKey === input.modelKey,
    );
    if (!route || route.state !== 'READY') {
      throw new Error(route?.availabilityReason || 'The selected vision model is unavailable');
    }

    runningIds.add(input.id);
    try {
      const running = database.beginImageBreakdown(input.id, input.focus, input.routeKey, route.modelKey);
      try {
        const imagePath = database.getImageBreakdownAssetPath(running.sourceAsset.id);
        if (!imagePath) throw new Error('Image breakdown source is unavailable');
        const result = await withModelImagePath(imagePath, async (modelPath) =>
          imageBreakdownResultSchema.parse(
            await assistant.imageBreakdown({
              imagePath: modelPath,
              mimeType: imageMimeType(modelPath),
              focus: input.focus,
              locale: input.locale,
              routeKey: input.routeKey,
              modelKey: route.modelKey,
            }),
          ),
        );
        return database.succeedImageBreakdown(input.id, result);
      } catch (error) {
        const details = errorDetails(error);
        database.failImageBreakdown(input.id, details.code, details.message);
        throw error;
      }
    } finally {
      runningIds.delete(input.id);
    }
  });

  ipcMain.handle('image-breakdown:create-image-form', (_event, raw) => {
    const input = imageBreakdownImageFormCreateInputSchema.parse(raw);
    const breakdown = database.getImageBreakdown(input.id);
    const existing = database.getImageBreakdownImageForm(input.id);
    const prompt = database.imageBreakdownPrompt(input.id, input.promptKind);
    const promptInput = {
      title: breakdown.title,
      titleLocale: input.locale,
      manualPrompt: prompt,
      promptNodes: [{ kind: 'TEXT' as const, text: prompt }],
      prompt,
      changeSummary: input.locale === 'zh' ? '由图片拆解创建' : 'Created from image breakdown',
      referenceAssetIds: [breakdown.sourceAsset.id],
      termPromptLocale: input.locale,
      termIds: [],
      wordPaletteReferences: [],
    };
    if (existing) {
      return imageBreakdownImageFormCreateResultSchema.parse(
        database.createPromptVersion({
          seriesId: existing.seriesId,
          baseVersionId: existing.versionId,
          ...promptInput,
        }),
      );
    }
    const item = database.getImageBreakdownCreationItem(input.id);
    if (!item) throw new Error('Image breakdown creation item is unavailable');
    const draft = database.startCreationDraft({
      albumId: item.albumId,
      termPromptLocale: input.locale,
    });
    const result = database.commitCreationDraft({
      creationDraftId: draft.id,
      imageBreakdownId: input.id,
      ...promptInput,
    });
    return imageBreakdownImageFormCreateResultSchema.parse(result);
  });
}

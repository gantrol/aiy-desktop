import type { NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { z } from 'zod';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import type { ArticleDeliveryJobCoordinator } from '@/main/extensions/article-delivery/job-coordinator';
import {
  assertArticleDeliveryExtensionActivated,
  resolveArticleDeliveryDefinition,
} from '@/main/extensions/article-delivery/definition';
import { ArticleDeliveryService } from '@/main/extensions/article-delivery/service';
import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  articleDeliveryArticleProfileSaveInputSchema,
  articleDeliveryArticleProfileSchema,
  articleDeliveryArticleTargetSchema,
  articleDeliveryConnectionDtoSchema,
  articleDeliveryConnectionSaveInputSchema,
  articleDeliveryExtensionTargetSchema,
  articleDeliveryJobListInputSchema,
  articleDeliveryJobRetryInputSchema,
  articleDeliveryJobSchema,
  articleDeliveryStatusSchema,
  articleDeliveryUploadInputSchema,
  articleDeliveryUploadResultSchema,
  type ArticleDeliveryExtensionTarget,
} from '@/shared/contracts/article-delivery';

const legacyArticleDeliveryUploadInputSchema = articleDeliveryArticleTargetSchema
  .extend({
    // One development preload build emitted a lowercase `l` in place of the `I` in `Id`.
    expectedRevisionld: z.unknown(),
  })
  .strict();

function parseArticleDeliveryUploadInput(rawInput: unknown) {
  const current = articleDeliveryUploadInputSchema.safeParse(rawInput);
  if (current.success) return current.data;

  const legacy = legacyArticleDeliveryUploadInputSchema.safeParse(rawInput);
  if (!legacy.success) throw current.error;
  const { expectedRevisionld, ...target } = legacy.data;
  return articleDeliveryUploadInputSchema.parse({ ...target, expectedRevisionId: expectedRevisionld });
}

export function registerArticleDeliveryIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
  connections: ArticleDeliveryConnections,
  jobs: ArticleDeliveryJobCoordinator,
  naturalWatermark?: NaturalWatermarkRuntime,
) {
  const captureExtensions = () => ({
    get: extensions.get,
    isActivated: extensions.isActivated,
    isPermissionGranted: extensions.isPermissionGranted,
  });
  const captureDatabase = () => ({
    libraryRoot: database.libraryRoot,
    getArticle: database.getArticle,
    getArticleRevision: database.getArticleRevision,
    contentLibrary: database.contentLibrary,
    resolveAssetFilesAsync: database.resolveAssetFilesAsync,
  });
  const context = async (
    target: ArticleDeliveryExtensionTarget,
    capturedExtensions: ReturnType<typeof captureExtensions>,
  ) => {
    const definition = resolveArticleDeliveryDefinition(capturedExtensions, target);
    const connection = await connections.get(target.extensionId);
    return { definition, connection };
  };
  const active = (target: ArticleDeliveryExtensionTarget, capturedExtensions: ReturnType<typeof captureExtensions>) => {
    assertArticleDeliveryExtensionActivated(capturedExtensions, target.extensionId);
  };

  ipcMain.handle('article-delivery:connection-get', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const { definition, connection } = await context(target, captureExtensions());
    return articleDeliveryConnectionDtoSchema.parse(connection.status(definition));
  });
  ipcMain.handle('article-delivery:connection-save', async (_event, rawInput) => {
    const input = articleDeliveryConnectionSaveInputSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    active(input, capturedExtensions);
    const { definition, connection } = await context(input, capturedExtensions);
    return articleDeliveryConnectionDtoSchema.parse(await connection.saveAndTest(definition, input));
  });
  ipcMain.handle('article-delivery:connection-test', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    active(target, capturedExtensions);
    const { definition, connection } = await context(target, capturedExtensions);
    return articleDeliveryConnectionDtoSchema.parse(await connection.test(definition));
  });
  ipcMain.handle('article-delivery:connection-clear', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const { definition, connection } = await context(target, captureExtensions());
    return articleDeliveryConnectionDtoSchema.parse(await connection.clear(definition));
  });
  ipcMain.handle('article-delivery:status', async (_event, rawInput) => {
    const input = articleDeliveryArticleTargetSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    const capturedDatabase = captureDatabase();
    const { definition, connection } = await context(input, capturedExtensions);
    const delivery = new ArticleDeliveryService(
      capturedDatabase,
      capturedExtensions,
      connection,
      definition,
      undefined,
      naturalWatermark,
    );
    return articleDeliveryStatusSchema.parse(delivery.status(input));
  });
  ipcMain.handle('article-delivery:profile-save', async (_event, rawInput) => {
    const input = articleDeliveryArticleProfileSaveInputSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    const capturedDatabase = captureDatabase();
    active(input, capturedExtensions);
    const { definition, connection } = await context(input, capturedExtensions);
    const delivery = new ArticleDeliveryService(
      capturedDatabase,
      capturedExtensions,
      connection,
      definition,
      undefined,
      naturalWatermark,
    );
    return articleDeliveryArticleProfileSchema.parse(await delivery.saveProfile(input));
  });
  ipcMain.handle('article-delivery:upload', async (_event, rawInput) => {
    const input = parseArticleDeliveryUploadInput(rawInput);
    const capturedExtensions = captureExtensions();
    const capturedDatabase = captureDatabase();
    const { definition, connection } = await context(input, capturedExtensions);
    const delivery = new ArticleDeliveryService(
      capturedDatabase,
      capturedExtensions,
      connection,
      definition,
      undefined,
      naturalWatermark,
    );
    return articleDeliveryUploadResultSchema.parse(await delivery.upload(input));
  });
  ipcMain.handle('article-delivery:job-enqueue', async (_event, rawInput) => {
    const input = parseArticleDeliveryUploadInput(rawInput);
    return articleDeliveryJobSchema.parse(await jobs.enqueue(input));
  });
  ipcMain.handle('article-delivery:jobs-list', (_event, rawInput) => {
    const input = articleDeliveryJobListInputSchema.parse(rawInput);
    return articleDeliveryJobSchema.array().max(50).parse(jobs.list(input));
  });
  ipcMain.handle('article-delivery:job-retry', (_event, rawInput) => {
    const input = articleDeliveryJobRetryInputSchema.parse(rawInput);
    return articleDeliveryJobSchema.parse(jobs.retry(input));
  });
}
